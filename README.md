# Polythene Business Manager

Stock, purchases, sales, debts, expenses and profit reports for a polythene-bag business.
Counting: **producer sells bundles → each bundle has packets → you sell packets (or whole bundles)**. Pieces inside a packet are not tracked.
Plain HTML + CSS + JavaScript (ES modules) with Supabase (Auth + Postgres). No build step.
Currency: UGX. Your original tables are **unchanged**.

## What it does
| Page | What happens |
|---|---|
| **Dashboard** | Today's sales, 30-day net profit, customer debts, stock value, 14-day chart, low-stock alerts |
| **Sales** | Multi-product sales (packets or bundles). Stock is checked and reduced automatically. Receipts can be printed. Owner can cancel a sale (stock returns). |
| **Products & Stock** | Add/edit products, stock shown as bundles + packets, stock adjustments with a reason, full stock history per product |
| **Purchases** | Multi-product purchases that add stock and update the average cost. Supplier balances. |
| **Payments & Debts** | Who owes you, who you owe, receive/pay part-payments, full payment history |
| **Expenses** | Date and category filters, CSV export |
| **Reports** | Real profit = sales − cost of goods sold − expenses. This week / last week / custom range, print or save as PDF (use "Last week" for your partner's weekly report) |
| **Users** | Owner changes names, roles and access |

Roles: **Owner** (everything) · **Partner** (stock, purchases, reports) · **Staff** (sales, expenses, customer payments).

## Setup
1. **Supabase → SQL Editor**: run `sql/01_schema.sql` (your original tables), then `sql/02_logic.sql` (functions, security, reports). Both are safe to run again.
   - On an existing database that already has data, only run `02_logic.sql`.
2. **config.js**: your URL and anon key are already filled in. Set `BUSINESS_NAME` for receipts. The anon key is meant to be public; protection comes from the database rules. Never use the `service_role` key here.
3. **Create users**: Supabase → Authentication → Users → Add user (tick *Auto confirm*). Everyone starts as Staff. Make yourself owner once:
   ```sql
   update public.profiles set full_name = 'Eddy', role = 'owner' where id = 'YOUR-USER-UUID';
   ```
   After that, manage everyone from the **Users** page.
4. **Run it** through a web server, not by double-clicking: VS Code *Live Server*, or `python3 -m http.server 8000` then open http://localhost:8000.
5. **Deploy**: upload the folder to any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages). In Supabase → Authentication → URL Configuration, add your site address (needed for password-reset emails).

## Project layout
```
index.html          page shell
config.js           your Supabase keys + business name
css/styles.css      all styling (teal #01605a, orange #ff862d)
js/main.js          sign-in, menu, routing
js/api.js           every database call
js/ui.js            tables, modals, form fields
js/lineitems.js     product-lines editor for sales and purchases
js/pages/*.js       one file per page
sql/01_schema.sql   your original tables
sql/02_logic.sql    stock logic, security rules, report function
```

## How the numbers work
- Stock is counted in **packets**. A product's "Packets in one bundle" lets you enter and see stock as bundles + packets. (The database columns are still named `pieces_*` because your tables were not changed; read them as packets.)
- You enter the **buying price per bundle**; the app works out the cost per packet. Selling price is set **per packet**; selling a bundle is packets × price (you can edit the amount on the line).
- A sale stores each product's cost at that moment (in `stock_movements`), so profit stays correct if prices change later.
- Purchase cost uses a **weighted average** so cost per piece updates automatically.
- Line prices of each sale/purchase are kept in `stock_movements.notes` and read back through the views `v_sale_lines` and `v_purchase_lines` (no new tables were needed).
- The browser can no longer change stock, sales, purchases or payments directly. Only the database functions can, so numbers cannot drift.

## Known limits
- There is no customers table, so customers are matched by name. Type names consistently (the form suggests earlier names).
- Cancelling a sale or purchase deletes the record and its payments, and keeps the stock trail in the product history.
- Staff can see product cost prices in the products table query; give "Staff" only to people you trust with that.
- Back up your data regularly (Supabase → Database → Backups) and test with sample records first.
