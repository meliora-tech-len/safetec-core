import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getInvoice, updateInvoice, deleteInvoice, downloadInvoicePdf } from '../services/api'
import { useTheme } from '../hooks/useTheme'
import { formatCurrency, formatDate, statusBadgeClass, statusLabel, errorMessage } from '../utils/helpers'
import toast from 'react-hot-toast'
import { ArrowLeft, Edit2, Download, Trash2, CheckCircle, ChevronDown, Mail, Send } from 'lucide-react'
import DeleteModal from '../components/DeleteModal'
import DateInput from '../components/DateInput'

const STATUS_FLOW = {
  draft:     ['ready', 'cancelled'],
  ready:     ['sent', 'cancelled'],
  sent:      ['accepted', 'overdue', 'cancelled'],
  accepted:  ['cancelled'],
  overdue:   ['cancelled'],
  paid:      [],
  cancelled: [],
}

export default function InvoiceDetailPage({ docType = 'invoice' }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const { theme } = useTheme()
  const isInvoice = docType === 'invoice'
  const isPO      = docType === 'purchase_order'
  const docPath   = isInvoice ? 'invoices' : isPO ? 'purchase-orders' : 'quotes'
  const [invoice, setInvoice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [showPayModal, setShowPayModal] = useState(false)
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [payRef, setPayRef] = useState('')

  const load = () => {
    setLoading(true)
    getInvoice(id).then(r => setInvoice(r.data)).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  const handleStatusChange = async (newStatus) => {
    setUpdating(true)
    try {
      await updateInvoice(id, { status: newStatus })
      toast.success(`Status updated to ${newStatus}`)
      load()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setUpdating(false)
    }
  }

  const handleRecordPayment = async () => {
    setUpdating(true)
    try {
      await updateInvoice(id, {
        status: 'paid',
        paid_date: new Date(payDate).toISOString(),
        payment_reference: payRef || null,
      })
      toast.success('Payment recorded')
      setShowPayModal(false)
      setPayRef('')
      load()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setUpdating(false)
    }
  }

  const [showDeleteModal, setShowDeleteModal] = useState(false)

  const handleDelete = () => setShowDeleteModal(true)

  const handlePdf = async (pdfTheme) => {
    try { await downloadInvoicePdf(invoice.id, invoice.invoice_number, pdfTheme) }
    catch { toast.error('PDF generation failed') }
  }

  const handleEmail = async () => {
    try { await downloadInvoicePdf(invoice.id, invoice.invoice_number, theme) }
    catch { toast.error('PDF generation failed'); return }

    const docLabel = invoice.document_type === 'invoice' ? 'Invoice' : 'Quote'
    const subject = encodeURIComponent(`${docLabel} ${invoice.invoice_number}`)
    const body = encodeURIComponent(
      `Dear ${(invoice.supplier || invoice.customer)?.name || 'Client'},\n\nPlease find attached ${docLabel.toLowerCase()} ${invoice.invoice_number}.\n\nKind regards`
    )
    const to = (invoice.supplier || invoice.customer)?.email || ''
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  if (!invoice) return null

  const nextStatuses = STATUS_FLOW[invoice.status] || []
  const canRecordPayment = invoice.status === 'sent' || invoice.status === 'overdue'

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.topBar}>
        <button className="btn-ghost btn-sm" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> Back
        </button>
        <div style={styles.actions}>
          {/* PDF split button */}
          <div style={{ position: 'relative', display: 'inline-flex' }}>
            <button className="btn-ghost btn-sm" style={{ borderRadius: '6px 0 0 6px', borderRight: 'none' }}
              onClick={() => handlePdf(theme)}>
              <Download size={13} /> PDF
            </button>
            <button className="btn-ghost btn-sm" style={{ borderRadius: '0 6px 6px 0', padding: '5px 7px' }}
             onClick={() => handlePdf(theme)}>
              <ChevronDown size={12} />
            </button>
          </div>
          <button className="btn-ghost btn-sm" onClick={handleEmail}>
            <Mail size={13} /> Email
          </button>
          {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
            <button className="btn-ghost btn-sm" onClick={() => navigate(`/${docPath}/${id}/edit`)}>
              <Edit2 size={13} /> Edit
            </button>
          )}
          {/* Prominent "Mark as Sent" when ready to send */}
          {invoice.status === 'ready' && (
            <button className="btn-primary btn-sm" onClick={() => handleStatusChange('sent')} disabled={updating}>
              <Send size={13} /> Mark as Sent
            </button>
          )}
          {canRecordPayment && (
            <button className="btn-primary btn-sm" onClick={() => setShowPayModal(true)} disabled={updating}>
              <CheckCircle size={13} /> Record Payment
            </button>
          )}
          {nextStatuses.filter(s => !(invoice.status === 'ready' && s === 'sent')).map(s => (
            <button key={s} className="btn-ghost btn-sm"
              onClick={() => handleStatusChange(s)} disabled={updating}>
              Mark as {statusLabel(s)}
            </button>
          ))}
          {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
            <button className="btn-ghost btn-sm" onClick={handleDelete}><Trash2 size={13} color="var(--danger)" /></button>
          )}
        </div>
      </div>

      {/* Ready-to-send banner */}
      {invoice.status === 'ready' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
          padding: '10px 16px', borderRadius: 8,
          background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)',
        }}>
          <Send size={14} style={{ color: '#a78bfa', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: '#a78bfa', flex: 1 }}>
            PDF has been generated. Once you have sent this {invoice.document_type}, click <strong>Mark as Sent</strong> to update the status.
          </span>
          <button className="btn-primary btn-sm" onClick={() => handleStatusChange('sent')} disabled={updating}>
            <Send size={12} /> Mark as Sent
          </button>
        </div>
      )}

      <div style={styles.grid}>
        {/* Invoice card */}
        <div style={styles.invoiceCard}>
          {/* Invoice header */}
          <div style={styles.invHeader}>
            <div>
              <div style={styles.docType}>{invoice.document_type.toUpperCase()}</div>
              <div style={styles.invNumber}>{invoice.invoice_number}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={styles.entityName}>{invoice.entity?.name}</div>
              {invoice.entity?.address && <div style={styles.invSub}>{invoice.entity.address}</div>}
              {invoice.entity?.vat_number && <div style={styles.invSub}>VAT: {invoice.entity.vat_number}</div>}
            </div>
          </div>

          {/* Meta row */}
          <div style={styles.metaRow}>
            {[
              ['Issue Date', formatDate(invoice.issue_date)],
              ['Due Date', formatDate(invoice.due_date)],
              ...(invoice.paid_date ? [['Paid Date', formatDate(invoice.paid_date)]] : []),
              ['Status', null],
            ].map(([label, val]) => (
              <div key={label} style={styles.metaCell}>
                <div style={styles.metaLabel}>{label}</div>
                {val !== null ? (
                  <div style={styles.metaVal}>{val}</div>
                ) : (
                  <span className={statusBadgeClass(invoice.status)}>{statusLabel(invoice.status)}</span>
                )}
              </div>
            ))}
          </div>

          {/* Bill To */}
          <div style={styles.billTo}>
            <div style={styles.metaLabel}>Bill To</div>
            {(() => {
              const r = invoice.supplier || invoice.customer
              return r ? (
                <>
                  <div style={{ fontWeight: 700, marginTop: 6 }}>{r.name}</div>
                  {r.address && <div style={styles.invSub}>{r.address}</div>}
                  {r.email && <div style={styles.invSub}>{r.email}</div>}
                  {r.phone && <div style={styles.invSub}>{r.phone}</div>}
                </>
              ) : <div style={{ marginTop: 6, color: 'var(--text-muted)' }}>—</div>
            })()}
          </div>

          {/* Line items */}
          <table style={{ marginTop: 20 }}>
            <thead>
              <tr style={{ background: 'var(--bg-base)' }}>
                <th>Description</th>
                <th style={{ textAlign: 'right', width: 70 }}>Qty</th>
                <th style={{ textAlign: 'right', width: 120 }}>Unit Price</th>
                <th style={{ textAlign: 'right', width: 120 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {[...invoice.line_items].sort((a, b) => a.sort_order - b.sort_order).map(li => {
                const lt = li.line_type || 'item'
                if (lt === 'spacer') {
                  return <tr key={li.id} style={{ height: 12 }}><td colSpan={4} /></tr>
                }
                if (lt === 'header') {
                  return (
                    <tr key={li.id} style={{ background: 'var(--bg-base)' }}>
                      <td colSpan={4} style={{ fontWeight: 700, fontSize: 13, padding: '7px 10px', color: 'var(--accent)', borderBottom: '1px solid var(--border)' }}>
                        {li.description}
                      </td>
                    </tr>
                  )
                }
                if (lt === 'note') {
                  return (
                    <tr key={li.id}>
                      <td colSpan={4} style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--text-muted)', padding: '4px 10px' }}>
                        {li.description}
                      </td>
                    </tr>
                  )
                }
                // item (default)
                return (
                  <tr key={li.id}>
                    <td>{li.description}</td>
                    <td className="text-right">{li.quantity != null ? parseFloat(li.quantity) : '—'}</td>
                    <td className="text-right">{li.unit_price != null ? formatCurrency(li.unit_price) : '—'}</td>
                    <td className="text-right font-bold">{formatCurrency(li.amount)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Totals */}
          <div style={styles.totals}>
            <div style={styles.totalRow}><span>Subtotal</span><span>{formatCurrency(invoice.subtotal)}</span></div>
            <div style={styles.totalRow}><span>VAT ({Math.round(parseFloat(invoice.vat_rate) * 100)}%)</span><span>{formatCurrency(invoice.vat_amount)}</span></div>
            <div style={{ ...styles.totalRow, ...styles.grandTotal }}>
              <span>TOTAL DUE</span>
              <span style={{ color: 'var(--accent)' }}>{formatCurrency(invoice.total)}</span>
            </div>
          </div>

          {/* Banking */}
          {invoice.entity?.bank_account_number && (
            <div style={styles.banking}>
              <div style={styles.metaLabel}>Banking Details</div>
              <div style={{ marginTop: 6, fontSize: 13 }}>
                <strong>{invoice.entity.name}</strong><br />
                {invoice.entity.bank_name} {invoice.entity.bank_branch && `| ${invoice.entity.bank_branch}`}<br />
                Account: {invoice.entity.bank_account_number}<br />
                {invoice.entity.bank_reference && `Reference: ${invoice.entity.bank_reference}`}
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
          {/* Document Info */}
          <div className="card">
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12 }}>Document Info</div>
            <div style={styles.infoRow}>
              <span>Status</span>
              <span className={statusBadgeClass(invoice.status)}>{invoice.status}</span>
            </div>
            <div style={styles.infoRow}><span>Created</span><span>{formatDate(invoice.created_at)}</span></div>
            {invoice.updated_at && <div style={styles.infoRow}><span>Modified</span><span>{formatDate(invoice.updated_at)}</span></div>}
            <div style={styles.infoRow}><span>Entity</span><span style={{ fontWeight: 600 }}>{invoice.entity?.code}</span></div>
            <div style={styles.infoRow}><span>VAT Rate</span><span>{Math.round(parseFloat(invoice.vat_rate) * 100)}%</span></div>
            {invoice.payment_reference && (
              <div style={styles.infoRow}><span>Payment Ref</span><span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 11 }}>{invoice.payment_reference}</span></div>
            )}
            <div style={{ ...styles.infoRow, borderBottom: 'none' }}><span>Currency</span><span>ZAR (R)</span></div>
          </div>

          {/* Notes */}
          <div className="card" style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Notes</div>
              <span style={{
                fontSize: 10,
                color: invoice.print_note ? 'var(--accent)' : 'var(--text-muted)',
                background: invoice.print_note ? 'rgba(var(--accent-rgb),0.1)' : 'var(--bg-secondary)',
                padding: '2px 6px', borderRadius: 4,
              }}>
                {invoice.print_note ? 'printed on PDF' : 'not printed'}
              </span>
            </div>
            {invoice.notes
              ? <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{invoice.notes}</p>
              : <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>No notes</p>
            }
          </div>
        </div>
      </div>

      {/* Record Payment Modal */}
      {showPayModal && (
        <div style={styles.modalOverlay} onClick={() => setShowPayModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Record Payment</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{invoice.invoice_number}</span>
            </div>
            <div style={styles.modalBody}>
              <div style={styles.field}>
                <label style={styles.fieldLabel}>Payment Date</label>
                <DateInput
                  value={payDate}
                  onChange={e => setPayDate(e.target.value)}
                  style={styles.input}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.fieldLabel}>Payment Reference <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                <input
                  type="text"
                  placeholder="e.g. EFT123, Cheque #456"
                  value={payRef}
                  onChange={e => setPayRef(e.target.value)}
                  style={styles.input}
                />
              </div>
              <div style={{ background: 'var(--bg-surface)', borderRadius: 6, padding: '10px 14px', marginTop: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Amount Paid</span>
                  <span style={{ fontWeight: 800, color: 'var(--success)' }}>{formatCurrency(invoice.total)}</span>
                </div>
              </div>
            </div>
            <div style={styles.modalFooter}>
              <button className="btn-ghost btn-sm" onClick={() => setShowPayModal(false)}>Cancel</button>
              <button className="btn-primary btn-sm" onClick={handleRecordPayment} disabled={updating || !payDate}>
                <CheckCircle size={13} /> Confirm Payment
              </button>
            </div>
          </div>
        </div>
      )}

      <DeleteModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title={`Cancel ${invoice.invoice_number}`}
        description={`${(invoice.supplier || invoice.customer)?.name ? `${(invoice.supplier || invoice.customer).name} · ` : ''}${formatCurrency(invoice.total)}`}
        onArchive={async () => {
          try { await deleteInvoice(id); toast.success('Invoice cancelled'); navigate(-1) }
          catch (err) { toast.error(errorMessage(err)) }
          setShowDeleteModal(false)
        }}
      />
    </div>
  )
}

const styles = {
  page: { padding: '20px 28px', flex: 1 },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  actions: { display: 'flex', gap: 8, alignItems: 'center' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 240px', gap: 20, alignItems: 'stretch' },
  invoiceCard: {
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius)', padding: 28,
  },
  invHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  docType: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', marginBottom: 4 },
  invNumber: { fontSize: 26, fontWeight: 800, color: 'var(--accent)', fontFamily: 'monospace' },
  entityName: { fontSize: 14, fontWeight: 700 },
  invSub: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 },
  metaRow: {
    display: 'flex', gap: 0,
    border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginBottom: 20,
  },
  metaCell: { flex: 1, padding: '10px 14px', borderRight: '1px solid var(--border)', lastChild: { borderRight: 'none' } },
  metaLabel: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', marginBottom: 4 },
  metaVal: { fontSize: 13, fontWeight: 600 },
  billTo: { background: 'var(--bg-surface)', borderRadius: 6, padding: '12px 16px', marginBottom: 0 },
  totals: { borderTop: '2px solid var(--border)', marginTop: 16, paddingTop: 12 },
  totalRow: { display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 },
  grandTotal: { borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 10, fontWeight: 800, fontSize: 16 },
  banking: { marginTop: 12, padding: '12px 16px', background: 'var(--bg-surface)', borderRadius: 6 },
  infoRow: {
    display: 'flex', justifyContent: 'space-between',
    padding: '7px 0', fontSize: 12, borderBottom: '1px solid var(--border)',
    color: 'var(--text-secondary)',
  },
  // Modal
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 10, width: 380, boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  modalHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px', borderBottom: '1px solid var(--border)',
  },
  modalBody: { padding: '20px' },
  modalFooter: {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    padding: '12px 20px', borderTop: '1px solid var(--border)',
  },
  field: { marginBottom: 14 },
  fieldLabel: { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 },
  input: {
    width: '100%', padding: '8px 10px', borderRadius: 6,
    border: '1px solid var(--border)', background: 'var(--bg-surface)',
    color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box',
  },
}
