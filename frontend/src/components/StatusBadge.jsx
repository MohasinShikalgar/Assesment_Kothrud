import React from 'react';
import { CheckCircle2, Clock, AlertTriangle, XCircle, RotateCcw, AlertOctagon } from 'lucide-react';

export default function StatusBadge({ status = 'PENDING' }) {
  const normStatus = (status || '').toUpperCase();

  switch (normStatus) {
    case 'COMPLETED':
    case 'SUCCESS':
    case 'APPROVED':
      return (
        <span className="badge badge-success">
          <CheckCircle2 size={12} />
          {normStatus}
        </span>
      );

    case 'COMPENSATED':
      return (
        <span className="badge badge-warning" style={{ color: '#B45309', backgroundColor: '#FEF3C7' }}>
          <RotateCcw size={12} />
          COMPENSATED
        </span>
      );

    case 'COMPENSATING':
      return (
        <span className="badge badge-warning">
          <RotateCcw size={12} className="spin" />
          COMPENSATING
        </span>
      );

    case 'FAILED':
    case 'REJECTED':
      return (
        <span className="badge badge-danger">
          <XCircle size={12} />
          {normStatus}
        </span>
      );

    case 'RECOVERY_REQUIRED':
      return (
        <span className="badge badge-danger" style={{ backgroundColor: '#7F1D1D', color: '#FEE2E2' }}>
          <AlertOctagon size={12} />
          RECOVERY REQ
        </span>
      );

    case 'RUNNING':
    case 'VERIFICATION_IN_PROGRESS':
    case 'CREDIT_CHECK_IN_PROGRESS':
    case 'IN_PROGRESS':
      return (
        <span className="badge badge-info">
          <Clock size={12} />
          {normStatus.replace(/_/g, ' ')}
        </span>
      );

    case 'PENDING':
    default:
      return (
        <span className="badge badge-neutral">
          <Clock size={12} />
          {normStatus}
        </span>
      );
  }
}
