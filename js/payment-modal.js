// "Receive payment" (from customers) and "Pay supplier" modal, used by several pages.
import { openModal, formGrid } from './ui.js';
import { recordPayment } from './api.js';
import { money, today, toast } from './utils.js';

// kind: 'sale' | 'purchase'; rec: the sales or purchases row.
export function openPaymentModal(kind, rec, onDone) {
  const balance = Number(rec.total_amount) - Number(rec.amount_paid);
  const who = kind === 'sale' ? rec.customer_name : rec.supplier_name;
  const no = kind === 'sale' ? rec.sale_no : rec.purchase_no;
  openModal({
    eyebrow: kind === 'sale' ? 'RECEIVE PAYMENT' : 'PAY SUPPLIER',
    title: `${no} — ${who}`,
    submitLabel: kind === 'sale' ? 'Save payment' : 'Save payment',
    body: `<p class="muted">Total ${money(rec.total_amount)} · paid ${money(rec.amount_paid)} · <b>balance ${money(balance)}</b></p>` +
      formGrid([
        { name: 'amount', label: 'Amount (UGX)', type: 'number', min: 1, max: balance, step: 'any', value: balance, required: true },
        { name: 'date', label: 'Date', type: 'date', value: today(), required: true },
        { name: 'method', label: 'Method', type: 'select', value: 'cash', options: [['cash', 'Cash'], ['mobile_money', 'Mobile money'], ['bank', 'Bank'], ['other', 'Other']] },
        { name: 'reference', label: 'Reference (optional)', placeholder: 'e.g. mobile money code' },
      ]),
    onSubmit: async (v) => {
      await recordPayment(kind, rec.id, Number(v.amount), v.method, v.date, v.reference);
      toast('Payment recorded');
      onDone?.();
    },
  });
}
