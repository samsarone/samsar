function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderButton({ href, label }) {
  return `
    <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"
      style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;padding:11px 16px;font-size:14px;font-weight:700;">
      ${escapeHtml(label)}
    </a>
  `;
}

export function getRenderCompleteMailSubject() {
  return 'Your Samsar video is ready';
}

export function getRenderCompleteMailBody(payload = {}) {
  const { userName, sessionLink, downloadLink } = payload;
  const safeName = escapeHtml(userName || 'there');
  const actions = [
    sessionLink ? renderButton({ href: sessionLink, label: 'Open session' }) : '',
    downloadLink ? renderButton({ href: downloadLink, label: 'Download video' }) : '',
  ].filter(Boolean);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Your video is ready</title>
  </head>
  <body style="margin:0;background:#0f172a;color:#e2e8f0;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;color:transparent;">Your Samsar video finished rendering.</div>
    <div style="max-width:620px;margin:0 auto;padding:32px 18px;">
      <div style="border:1px solid #1e293b;border-radius:8px;background:#111827;padding:28px;">
        <p style="margin:0 0 10px;color:#60a5fa;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Render complete</p>
        <h1 style="margin:0 0 16px;color:#f8fafc;font-size:26px;line-height:1.25;">Your video is ready</h1>
        <p style="margin:0 0 18px;color:#cbd5e1;font-size:15px;line-height:1.65;">
          Hi ${safeName}, your video finished rendering and is ready to review.
        </p>
        <p style="margin:0 0 20px;color:#cbd5e1;font-size:15px;line-height:1.65;">
          The generated video is available from your Samsar session.
        </p>
        ${actions.length ? `<div style="display:block;margin:0 0 20px;">${actions.join('<span style="display:inline-block;width:10px;"></span>')}</div>` : ''}
        <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">Sent to ${safeName} by Samsar.</p>
      </div>
      <p style="margin:16px 0 0;color:#64748b;font-size:12px;line-height:1.6;text-align:center;">Questions? Reply to this email or visit Samsar.</p>
    </div>
  </body>
</html>`;
}

export function getRenderCompleteMailText(payload = {}) {
  const { userName, sessionLink, downloadLink } = payload;
  const lines = [
    'Your video is ready',
    '',
    `Hi ${userName || 'there'}, your video finished rendering and is ready to review.`,
    'The generated video is available from your Samsar session.',
  ];

  if (sessionLink) {
    lines.push('', `Open session: ${sessionLink}`);
  }
  if (downloadLink) {
    lines.push(`Download video: ${downloadLink}`);
  }

  lines.push('', 'Questions? Reply to this email or visit Samsar.');
  return lines.join('\n');
}
