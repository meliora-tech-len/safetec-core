import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getInvoice, updateInvoice, deleteInvoice, downloadInvoicePdf,
  uploadInvoiceAttachment, deleteInvoiceAttachment, viewInvoiceAttachment,
} from '../services/api'
import { useTheme } from '../hooks/useTheme'
import { formatCurrency, formatDate, statusBadgeClass, statusLabel, errorMessage } from '../utils/helpers'
import toast from 'react-hot-toast'
import { ArrowLeft, Edit2, Download, Trash2, CheckCircle, ChevronDown, Mail, Send, AlertTriangle, Paperclip, Upload, Eye, X } from 'lucide-react'
import DeleteModal from '../components/DeleteModal'
import DateInput from '../components/DateInput'

// True when an invoice came from a Tradekor PO import (Obhi/Safetec/Bokamosho) —
// mirrors InvoicesPage's isPoImport so the PO-attachment card only shows where
// there's actually a PO to attach.
function isPoImport(inv) {
  const fromNotes = (inv?.notes || '').match(/POH\s*\d+/i)
  if (fromNotes) return true
  const header = (inv?.line_items || []).find(li => li.line_type === 'header')
  return /POH\s*\d+/i.test(header?.description || '')
}

// Any status can be set from the "Change Status" override menu — this also lets
// users correct mistakes (e.g. an invoice marked paid by accident).
const ALL_STATUSES = ['draft', 'ready', 'sent', 'accepted', 'paid', 'overdue', 'cancelled']

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
  const [payConfirming, setPayConfirming] = useState(false)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const [revertTarget, setRevertTarget] = useState(null)
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [payRef, setPayRef] = useState('')
  const [attachBusy, setAttachBusy] = useState(false)
  const [pdfMenuOpen, setPdfMenuOpen] = useState(false)
  const attachInputRef = useRef(null)

  const closePayModal = () => {
    setShowPayModal(false)
    setPayConfirming(false)
  }

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

  // Route a status pick: "paid" goes through the Record Payment modal (to capture
  // date/ref); reverting a paid invoice asks for confirmation first; anything
  // else applies immediately.
  const onPickStatus = (s) => {
    setStatusMenuOpen(false)
    if (s === 'paid') { setShowPayModal(true); return }
    if (invoice.status === 'paid') { setRevertTarget(s); return }
    handleStatusChange(s)
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
      setPayConfirming(false)
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

  const handlePdf = async (pdfTheme, includeAttachment = true) => {
    try { await downloadInvoicePdf(invoice.id, invoice.invoice_number, pdfTheme, includeAttachment) }
    catch { toast.error('PDF generation failed') }
  }

  // ── PO attachment (attach the split PO PDF to its generated invoice) ────────
  const openAttachPicker = () => {
    if (attachInputRef.current) {
      attachInputRef.current.value = ''  // allow re-picking the same filename
      attachInputRef.current.click()
    }
  }

  const handleAttachFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAttachBusy(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await uploadInvoiceAttachment(invoice.id, formData)
      setInvoice(v => ({ ...v, ...data }))
      toast.success('PO attached — it will be included when you download the PDF')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setAttachBusy(false)
    }
  }

  const handleViewAttachment = async () => {
    try { await viewInvoiceAttachment(invoice.id) }
    catch (err) {
      // Record loaded fine — only the stored PO document is unreachable. A blob
      // 404 body can't be read by errorMessage(), so say it plainly instead.
      if (err?.response?.status === 404) {
        toast.error('This PO document is no longer in storage — re-upload it to restore the file.')
      } else {
        toast.error(errorMessage(err))
      }
    }
  }

  const handleRemoveAttachment = async () => {
    setAttachBusy(true)
    try {
      await deleteInvoiceAttachment(invoice.id)
      setInvoice(v => ({ ...v, has_attachment: false, attachment_filename: null }))
      toast.success('PO attachment removed')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setAttachBusy(false)
    }
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

  const canRecordPayment = ['sent', 'overdue', 'accepted'].includes(invoice.status)

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.topBar}>
        <button className="btn-ghost btn-sm" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> Back
        </button>
        <div style={styles.actions}>
          {/* PDF split button — when a PO is attached, the chevron offers a choice
              between the merged download (default) and the invoice alone */}
          <div style={{ position: 'relative', display: 'inline-flex' }}>
            <button className="btn-ghost btn-sm" style={{ borderRadius: '6px 0 0 6px', borderRight: 'none' }}
              onClick={() => handlePdf(theme, true)}>
              <Download size={13} /> PDF
            </button>
            <button className="btn-ghost btn-sm" style={{ borderRadius: '0 6px 6px 0', padding: '5px 7px' }}
             onClick={() => invoice.has_attachment ? setPdfMenuOpen(o => !o) : handlePdf(theme, true)}>
              <ChevronDown size={12} />
            </button>
            {pdfMenuOpen && invoice.has_attachment && (
              <>
                <div onClick={() => setPdfMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div style={{
                  position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 41,
                  background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6,
                  boxShadow: '0 6px 18px rgba(0,0,0,0.18)', minWidth: 210, overflow: 'hidden', padding: 4,
                }}>
                  <button onClick={() => { setPdfMenuOpen(false); handlePdf(theme, true) }} style={menuItemStyle}>
                    Invoice + PO (merged)
                  </button>
                  <button onClick={() => { setPdfMenuOpen(false); handlePdf(theme, false) }} style={menuItemStyle}>
                    Invoice only
                  </button>
                </div>
              </>
            )}
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
          {/* Change Status override — set any status (corrects mistakes incl. paid → unpaid) */}
          <div style={{ position: 'relative', display: 'inline-flex' }}>
            <button className="btn-ghost btn-sm" onClick={() => setStatusMenuOpen(o => !o)} disabled={updating}>
              Change Status <ChevronDown size={12} />
            </button>
            {statusMenuOpen && (
              <>
                <div onClick={() => setStatusMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 41,
                  background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6,
                  boxShadow: '0 6px 18px rgba(0,0,0,0.18)', minWidth: 180, overflow: 'hidden', padding: 4,
                }}>
                  {ALL_STATUSES.filter(s => s !== invoice.status).map(s => (
                    <button key={s} onClick={() => onPickStatus(s)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                        padding: '7px 10px', background: 'none', border: 'none', borderRadius: 5,
                        cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                      <span className={statusBadgeClass(s)}>{statusLabel(s)}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
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
          {(() => {
            const sortedLines = [...invoice.line_items].sort((a, b) => a.sort_order - b.sort_order)
            const isPO =
              (invoice.notes || '').includes('PO Ref:') ||
              sortedLines.some(l => (l.line_type === 'item' || !l.line_type) && (l.loading_number || l.offloading_number))
            const colSpan = isPO ? 6 : 4
            return (
              <table style={{ marginTop: 20 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-base)' }}>
                    <th>Description</th>
                    {isPO && <th style={{ textAlign: 'right', width: 90 }}>Loading #</th>}
                    {isPO && <th style={{ textAlign: 'right', width: 90 }}>Off-loading #</th>}
                    <th style={{ textAlign: 'right', width: 70 }}>Qty</th>
                    <th style={{ textAlign: 'right', width: 120 }}>Unit Price</th>
                    <th style={{ textAlign: 'right', width: 120 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLines.map(li => {
                    const lt = li.line_type || 'item'
                    if (lt === 'spacer') {
                      return <tr key={li.id} style={{ height: 12 }}><td colSpan={colSpan} /></tr>
                    }
                    if (lt === 'header') {
                      return (
                        <tr key={li.id} style={{ background: 'var(--bg-base)' }}>
                          <td colSpan={colSpan} style={{ fontWeight: 700, fontSize: 13, padding: '7px 10px', color: 'var(--accent)', borderBottom: '1px solid var(--border)' }}>
                            {li.description}
                          </td>
                        </tr>
                      )
                    }
                    if (lt === 'note') {
                      return (
                        <tr key={li.id}>
                          <td colSpan={colSpan} style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--text-muted)', padding: '4px 10px' }}>
                            {li.description}
                          </td>
                        </tr>
                      )
                    }
                    // item (default)
                    return (
                      <tr key={li.id}>
                        <td>{li.description}</td>
                        {isPO && <td className="text-right">{li.loading_number || '—'}</td>}
                        {isPO && <td className="text-right">{li.offloading_number || '—'}</td>}
                        <td className="text-right">
                          {li.quantity != null ? parseFloat(li.quantity).toLocaleString('en-ZA') : '—'}
                          {/* Adjusted line: show what it was derived from, so the
                              billed figure is never an unexplained number. */}
                          {li.qty_adjusted && li.base_quantity != null && (
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {parseFloat(li.base_quantity).toLocaleString('en-ZA')} +{parseFloat(invoice.qty_adjustment_pct)}%
                            </div>
                          )}
                        </td>
                        <td className="text-right">{li.unit_price != null ? formatCurrency(li.unit_price) : '—'}</td>
                        <td className="text-right font-bold">{formatCurrency(li.amount)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          })()}

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

          {/* PO attachment — only for invoices generated via PO Import */}
          {isPoImport(invoice) && (
            <div className="card">
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12 }}>PO Attachment</div>
              {invoice.has_attachment ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Paperclip size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={invoice.attachment_filename}>
                    {invoice.attachment_filename || 'PO document'}
                  </span>
                  <button className="btn-icon btn-ghost" title="View attached PO" onClick={handleViewAttachment}>
                    <Eye size={13} />
                  </button>
                  <button className="btn-icon btn-ghost" disabled={attachBusy} title="Replace attached PO" onClick={openAttachPicker}>
                    <Upload size={12} />
                  </button>
                  <button className="btn-icon btn-ghost" disabled={attachBusy} title="Remove attached PO" onClick={handleRemoveAttachment}>
                    <X size={12} color="var(--danger)" />
                  </button>
                </div>
              ) : (
                <button className="btn-ghost btn-sm" disabled={attachBusy} onClick={openAttachPicker}>
                  <Paperclip size={13} /> Attach PO PDF
                </button>
              )}
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 0' }}>
                Attached PO is merged into this invoice's PDF on download.
              </p>
              <input ref={attachInputRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={handleAttachFile} />
            </div>
          )}

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

      {/* Revert-from-paid confirmation */}
      {revertTarget && (
        <div style={styles.modalOverlay} onClick={() => setRevertTarget(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Revert paid invoice?</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{invoice.invoice_number}</span>
            </div>
            <div style={styles.modalBody}>
              <div style={{
                display: 'flex', gap: 10, alignItems: 'flex-start',
                background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.3)',
                borderRadius: 6, padding: '12px 14px',
              }}>
                <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  Change <strong>{invoice.invoice_number}</strong> from <strong>Paid</strong> to{' '}
                  <strong>{statusLabel(revertTarget)}</strong>?
                  <div style={{ marginTop: 6 }}>The recorded payment date and reference will be cleared.</div>
                </div>
              </div>
            </div>
            <div style={styles.modalFooter}>
              <button className="btn-ghost btn-sm" onClick={() => setRevertTarget(null)} disabled={updating}>Cancel</button>
              <button className="btn-primary btn-sm" disabled={updating}
                onClick={async () => { const t = revertTarget; setRevertTarget(null); await handleStatusChange(t) }}>
                {updating ? 'Saving…' : `Yes, change to ${statusLabel(revertTarget)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {showPayModal && (
        <div style={styles.modalOverlay} onClick={closePayModal}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{payConfirming ? 'Mark as Paid?' : 'Record Payment'}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{invoice.invoice_number}</span>
            </div>

            {payConfirming ? (
              <>
                <div style={styles.modalBody}>
                  <div style={{
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                    background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.3)',
                    borderRadius: 6, padding: '12px 14px',
                  }}>
                    <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }} />
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                      Mark <strong>{invoice.invoice_number}</strong> as <strong>paid</strong> for{' '}
                      <strong style={{ color: 'var(--success)' }}>{formatCurrency(invoice.total)}</strong>?
                      <div style={{ marginTop: 6 }}>
                        A paid invoice is locked for edits. If it was a mistake, you can revert it later from <strong>Change Status</strong>.
                      </div>
                    </div>
                  </div>
                </div>
                <div style={styles.modalFooter}>
                  <button className="btn-ghost btn-sm" onClick={() => setPayConfirming(false)} disabled={updating}>← Back</button>
                  <button className="btn-primary btn-sm" onClick={handleRecordPayment} disabled={updating}>
                    <CheckCircle size={13} /> {updating ? 'Saving…' : 'Yes, Mark as Paid'}
                  </button>
                </div>
              </>
            ) : (
              <>
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
                  <button className="btn-ghost btn-sm" onClick={closePayModal}>Cancel</button>
                  <button className="btn-primary btn-sm" onClick={() => setPayConfirming(true)} disabled={updating || !payDate}>
                    <CheckCircle size={13} /> Confirm Payment
                  </button>
                </div>
              </>
            )}
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

const menuItemStyle = {
  display: 'flex', alignItems: 'center', gap: 9,
  width: '100%', padding: '9px 14px',
  background: 'none', border: 'none', cursor: 'pointer',
  fontSize: 13, color: 'var(--text-primary)', textAlign: 'left', whiteSpace: 'nowrap',
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
