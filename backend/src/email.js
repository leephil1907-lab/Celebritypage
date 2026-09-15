import nodemailer from 'nodemailer';

const allowlist = (process.env.EMAIL_ALLOWLIST || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);

export function isAllowedRecipient(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  // fc-member.familyclub.jp is always allowed (FC)
  if (domain === 'fc-member.familyclub.jp') return true;
  if (allowlist.length===0) return true;
  return allowlist.includes(domain);
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

export async function sendMail({ to, subject, text, html, tag }) {
  if (!isAllowedRecipient(to)) {
    throw new Error(`Recipient domain not allowed: ${to} (allowlist: ${allowlist.join(',')})`);
  }
  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    text,
    html,
    headers: tag ? { 'X-Tag': tag } : undefined,
  });
  console.info('[email] sent', { to, subject, id: info.messageId, tag });
  return info;
}

// 6-step FC join: STEP 2 — ファンクラブ入会申込みメール
export async function sendJoinApplicationMail({ to, token, baseUrl }) {
  const url = `${baseUrl || process.env.SITE_URL}/join/complete/?token=${encodeURIComponent(token)}`;
  return sendMail({
    to,
    tag: 'join-application',
    subject: '【FAMILY CLUB】Takuya Kimura ファンクラブ入会申込み — お客様情報登録のご案内',
    text: `
${to} 様

Takuya Kimura Official Fan Club へのお申し込みありがとうございます。

以下のURLより、お客様情報の登録を行ってください（有効期限 24時間）:

${url}

— 手順 —
1. 上記URLにアクセス
2. お客様情報（氏名・住所・生年月日）を入力
3. お支払い (5,140円: 入会金1,000 + 年会費4,000 + 事務手数料140) をクレジット / Pay-easy / コンビニより選択
4. 入金確認後、会員番号をメールでご案内 (24時間以内)
5. 会員証を郵送 (2-3週間, 転送不要)

※「fc-member.familyclub.jp」からのメールを受信できるよう設定してください。
※ iCloud/Gmail で遅延が確認されています。届かない場合は別ドメインをお試しください。

— STARTO ENTERTAINMENT / FAMILY CLUB
https://takuya-kimura.jp/join/
`.trim(),
    html: `
<div style="font-family:Inter,Noto Sans JP,sans-serif;max-width:560px;margin:0 auto;padding:24px;border:1px solid #e8ddd0;background:#fdfbf7">
  <div style="font-size:11px;letter-spacing:.14em;color:#9a958f">FAMILY CLUB • TAKUYA KIMURA</div>
  <h1 style="font-family:Cormorant Garamond,serif;font-weight:300;margin:8px 0">ファンクラブ入会申込み</h1>
  <p>${to} 様、お申し込みありがとうございます。</p>
  <p><a href="${url}" style="display:inline-block;background:#0f0e0c;color:#c9a86a;padding:12px 18px;text-decoration:none">お客様情報の登録へ進む →</a></p>
  <p style="font-size:12px;color:#4a4a4a">有効期限: 24時間<br>お支払い: 5,140円 (クレジット / Pay-easy / コンビニ)</p>
  <hr style="border:none;border-top:1px solid #e8ddd0;margin:18px 0">
  <p style="font-size:11px;color:#9a958f">※ fc-member.familyclub.jp 受信許可をお願いします。<br>STARTO ENTERTAINMENT • <a href="https://takuya-kimura.jp">takuya-kimura.jp</a></p>
</div>`,
  });
}

// STEP 5 — 会員番号発行
export async function sendJoinCompletedMail({ to, memberNo, cardUrl }) {
  return sendMail({
    to,
    tag: 'join-completed',
    subject: '【FAMILY CLUB】会員番号のご案内 — Takuya Kimura Official',
    text: `会員番号: ${memberNo}\n\nマイページ: ${cardUrl}\n会員証は2-3週間で郵送 (転送不要) いたします。\n\n— FAMILY CLUB`,
    html: `<div style="font-family:Inter,sans-serif;padding:24px;border:1px solid #e8ddd0"><h2>会員番号のご案内</h2><p style="font-family:JetBrains Mono,monospace;font-size:18px;letter-spacing:.12em">${memberNo}</p><p><a href="${cardUrl}">マイページで会員証を表示 →</a></p><p style="font-size:11px;color:#9a958f">会員証は2-3週間で郵送 (転送不要)</p></div>`,
  });
}

// Support ticket notification
export async function sendTicketUpdate({ to, ticketNo, status, subject }) {
  return sendMail({
    to,
    tag: 'ticket-update',
    subject: `【Support】Ticket ${ticketNo} ${status} — ${subject}`,
    text: `Ticket ${ticketNo} is now ${status}.\n${subject}\n\nView: ${process.env.SITE_URL}/support/`,
  });
}

export default transporter;
