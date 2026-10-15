const { Kafka, Partitioners, logLevel } = require('kafkajs');
const { EventEmitter } = require('events');
const { createLogger } = require('./logger');
const { metrics } = require('./metrics');
const { validateEventEnvelope } = require('./eventEnvelope');
const { TOPICS } = require('./eventTypes');
const { pool, query } = require('./db');

const logger = createLogger('event-bus');

class FlowMasterEventBus extends EventEmitter {
  constructor() {
    super();
    this.kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
    this.clientId = process.env.KAFKA_CLIENT_ID || 'flowmaster';
    this.kafka = null;
    this.producer = null;
    this.consumers = [];
    this.isKafkaConnected = false;
    this.connectionError = null;
    this.subscriptions = new Map(); // topic -> Array of handlers
    this.pgListenerClient = null;
    this.setMaxListeners(200);

    this._initializeKafka();
    this._initializePgPubSub();
  }

  _initializeKafka() {
    try {
      this.kafka = new Kafka({
        clientId: this.clientId,
        brokers: this.kafkaBrokers,
        connectionTimeout: 2000,
        requestTimeout: 3000,
        logLevel: logLevel.ERROR, // Suppress verbose warning noise when offline
        retry: {
          initialRetryTime: 300,
          retries: 1,
        },
      });

      this.producer = this.kafka.producer({
        createPartitioner: Partitioners.DefaultPartitioner,
      });

      this.producer.connect()
        .then(() => {
          this.isKafkaConnected = true;
          this.connectionError = null;
          logger.info(`[EventBus] Connected to Apache Kafka at ${this.kafkaBrokers.join(',')}`);
        })
        .catch((err) => {
          this.isKafkaConnected = false;
          this.connectionError = err.message;
          logger.warn(`[EventBus] Kafka broker offline (${err.message}). Using PostgreSQL event pipeline.`);
        });
    } catch (err) {
      this.isKafkaConnected = false;
      this.connectionError = err.message;
    }
  }

  /**
   * Initialize PostgreSQL LISTEN/NOTIFY for resilient cross-process event delivery when Kafka is offline
   */
  async _initializePgPubSub() {
    try {
      this.pgListenerClient = await pool.connect();
      await this.pgListenerClient.query('LISTEN flowmaster_events');

      this.pgListenerClient.on('notification', (msg) => {
        if (msg.channel === 'flowmaster_events' && msg.payload) {
          try {
            const data = JSON.parse(msg.payload);
            const { topic, envelope } = data;
            // Dispatch locally to handlers registered for this topic
            this.emit(topic, envelope);
            const handlers = this.subscriptions.get(topic) || [];
            for (const handler of handlers) {
              handler(envelope);
            }
          } catch (e) {
            logger.error(`[EventBus:PG] Notification parse error: ${e.message}`);
          }
        }
      });

      this.pgListenerClient.on('error', (err) => {
        logger.error(`[EventBus:PG] Listener client error: ${err.message}`);
      });
    } catch (err) {
      logger.warn(`[EventBus:PG] Could not initialize PG LISTEN channel: ${err.message}`);
    }
  }

  /**
   * Publish an event envelope to a Kafka topic
   */
  async publish(topic, envelope) {
    const validation = validateEventEnvelope(envelope);
    if (!validation.success) {
      logger.error(`[EventBus] Invalid event envelope for topic ${topic}`, validation.error);
      throw new Error(`Invalid event envelope: ${validation.error.message}`);
    }

    const payloadString = JSON.stringify(envelope);
    const partitionKey = envelope.workflowId || envelope.correlationId;

    metrics.eventsTotal.inc({
      topic,
      event_type: envelope.eventType,
      status: 'PUBLISHED',
    });

    // 1. Try Apache Kafka if connected
    if (this.isKafkaConnected && this.producer) {
      try {
        await this.producer.send({
          topic,
          messages: [
            {
              key: partitionKey,
              value: payloadString,
              headers: {
                correlationId: envelope.correlationId,
                eventType: envelope.eventType,
                source: envelope.source,
                timestamp: envelope.timestamp,
              },
            },
          ],
        });
        logger.info(`[EventBus:Kafka] Published to topic [${topic}], eventType [${envelope.eventType}], workflow [${envelope.workflowId}]`);
        return { published: true, broker: 'kafka', topic, eventId: envelope.eventId };
      } catch (err) {
        logger.warn(`[EventBus:Kafka] Failed to publish to Kafka: ${err.message}. Emitting via PostgreSQL pub/sub.`);
      }
    }

    // 2. Cross-process resilient PostgreSQL NOTIFY delivery
    try {
      const notifyPayload = JSON.stringify({ topic, envelope });
      await query('SELECT pg_notify($1, $2)', ['flowmaster_events', notifyPayload]);
    } catch (pgErr) {
      // In-process fallback
      setImmediate(() => {
        this.emit(topic, envelope);
        const handlers = this.subscriptions.get(topic) || [];
        for (const handler of handlers) {
          handler(envelope);
        }
      });
    }

    logger.info(`[EventBus] Dispatched event [${envelope.eventType}] to topic [${topic}] for workflow [${envelope.workflowId}]`);
    return { published: true, broker: 'postgresql_pubsub', topic, eventId: envelope.eventId };
  }

  /**
   * Subscribe a consumer group and handler to a topic
   */
  async subscribe(topic, groupId, handler) {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, []);
    }
    this.subscriptions.get(topic).push(handler);

    if (this.isKafkaConnected && this.kafka) {
      try {
        const consumer = this.kafka.consumer({ groupId });
        await consumer.connect();
        await consumer.subscribe({ topic, fromBeginning: false });

        await consumer.run({
          eachMessage: async ({ topic: msgTopic, partition, message }) => {
            try {
              const raw = message.value.toString();
              const envelope = JSON.parse(raw);
              await handler(envelope);
            } catch (err) {
              logger.error(`[EventBus:Kafka] Consumer error on topic ${msgTopic}: ${err.message}`);
              await this.publishToDLQ(msgTopic, message.value.toString(), err.message);
            }
          },
        });

        this.consumers.push(consumer);
        logger.info(`[EventBus:Kafka] Consumer group [${groupId}] subscribed to topic [${topic}]`);
      } catch (err) {
        logger.warn(`[EventBus:Kafka] Failed to create Kafka consumer for [${topic}]: ${err.message}`);
      }
    } else {
      logger.info(`[EventBus:Subscribed] Registered consumer for topic [${topic}] (group: ${groupId})`);
    }
  }

  /**
   * Dead Letter Queue (DLQ) publisher
   */
  async publishToDLQ(failedTopic, payload, errorReason) {
    try {
      const dlqEnvelope = {
        eventId: require('uuid').v4(),
        workflowId: '00000000-0000-0000-0000-000000000000',
        correlationId: 'dlq-error',
        eventType: 'DLQ_MESSAGE',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        source: 'eventBus',
        payload: {
          failedTopic,
          errorReason,
          rawPayload: payload,
        },
      };
      await this.publish(TOPICS.WORKFLOW_DLQ, dlqEnvelope);
      logger.warn(`[EventBus:DLQ] Sent failed message to ${TOPICS.WORKFLOW_DLQ}: ${errorReason}`);
    } catch (e) {
      logger.error(`[EventBus:DLQ] Failed to route to DLQ: ${e.message}`);
    }
  }

  async checkHealth() {
    return {
      status: this.isKafkaConnected ? 'UP' : 'STANDBY',
      mode: this.isKafkaConnected ? 'APACHE_KAFKA_BROKER' : 'POSTGRESQL_EVENT_BUS_STANDBY',
      brokers: this.kafkaBrokers,
      activeSubscriptions: Array.from(this.subscriptions.keys()),
      error: this.connectionError,
    };
  }

  async disconnect() {
    if (this.producer) {
      await this.producer.disconnect().catch(() => {});
    }
    for (const c of this.consumers) {
      await c.disconnect().catch(() => {});
    }
    if (this.pgListenerClient) {
      this.pgListenerClient.release();
    }
    this.isKafkaConnected = false;
  }
}

const eventBus = new FlowMasterEventBus();

module.exports = {
  eventBus,
  FlowMasterEventBus,
};
