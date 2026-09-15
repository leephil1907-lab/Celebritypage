/**
 * Celebritypage — Direct Email Notifications (Frontend)
 * Works in 2 modes:
 * 1. If apiBase (api.takuya-kimura.jp) is reachable → POST /api/auth/signup already sends email via backend (nodemailer)
 * 2. If static (no backend) → direct EmailJS / fallback toast + local log (so user sees email would be sent)
 * User can configure EmailJS or Resend by setting window.__EMAIL_CONFIG
 */
(function(){
  const CFG = window.__EMAIL_CONFIG || {
    // Public EmailJS example — replace with your keys in Vercel env or window.__EMAIL_CONFIG
    // Get free at https://www.emailjs.com (or Resend, SendGrid)
    emailjs: {
      enabled: false, // set true and fill below to send real emails from static
      serviceId: 'service_xxx',
      templateId: 'template_welcome',
      publicKey: 'public_xxx',
      // For ticket/booking templates, create separate templates
    },
    // Fallback: log to localStorage + toast (always works, shows user what email would be)
    fallback: true
  };

  async function sendDirect({to, subject, html, text, tag}){
    const apiBase = window.KimuraDB?.apiBase || document.querySelector('meta[name="kimura-api"]')?.content || '';
    // 1) Try backend if available (it already sends via nodemailer)
    if(apiBase){
      try{
        const r = await fetch(apiBase + '/api/notifications/email', {
          method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({to, subject, html, text, tag})
        });
        if(r.ok) {
          console.info('[email] backend sent', tag, to);
          return {ok:true, via:'backend'};
        }
      }catch(e){ console.warn('[email] backend failed, fallback', e.message); }
    }
    // 2) Try EmailJS if enabled
    if(CFG.emailjs?.enabled && window.emailjs){
      try{
        await window.emailjs.send(CFG.emailjs.serviceId, CFG.emailjs.templateId, {
          to_email: to, subject, message_html: html, message_text: text, tag
        });
        console.info('[email] EmailJS sent', tag, to);
        return {ok:true, via:'emailjs'};
      }catch(e){ console.warn('[email] EmailJS failed', e); }
    }
    // 3) Fallback: store in localStorage + toast (so user sees it would be sent)
    if(CFG.fallback){
      const outbox = JSON.parse(localStorage.getItem('st_email_outbox')||'[]');
      outbox.unshift({to, subject, text: text||html, tag, at:Date.now()});
      localStorage.setItem('st_email_outbox', JSON.stringify(outbox.slice(0,50)));
      console.info('[email] fallback logged', tag, to, subject);
      // Also show in UI
      if(window.toast) window.toast(`📧 Email queued for ${to}: ${subject} (configure SMTP/EmailJS to send real)`);
      return {ok:true, via:'fallback', queued:true};
    }
    return {ok:false};
  }

  window.EmailNotify = {
    async welcome({name, email}){
      const subject = `Welcome to Takuya Kimura Official — ${name} 様`;
      const html = `<div style="font-family:Inter,Noto Sans JP,sans-serif;max-width:560px;margin:0 auto;padding:24px;border:1px solid #e8ddd0;background:#fdfbf7"><div style="font-size:11px;letter-spacing:.14em;color:#9a958f">STARTO ENTERTAINMENT • TAKUYA KIMURA</div><h1 style="font-family:Cormorant Garamond,serif;font-weight:300;margin:8px 0 4px">Welcome, ${name} 様</h1><p>Official Fan Club へのご登録ありがとうございます。</p><p>Member ID: <b style="font-family:JetBrains Mono,monospace;letter-spacing:.12em">${email}</b></p><div style="margin-top:16px;padding:12px;background:#0f0e0c;color:#c9a86a;text-align:center">Your journey starts — explore Vault, Tour Passport & Booking</div><p style="margin-top:16px"><a href="https://celebritypage.vercel.app/members/" style="display:inline-block;background:#0f0e0c;color:#c9a86a;padding:10px 16px;text-decoration:none">Go to Members →</a></p><p style="font-size:11px;color:#9a958f;margin-top:18px">Replies from <b>Official Site / Management</b> only • Questions? Reply to this email or use Support Chat.</p></div>`;
      return sendDirect({to: email, subject, html, tag:'welcome'});
    },
    async ticket({email, name, ticketNo, tier, subject}){
      const subj = `【Support】Ticket #${ticketNo} — ${tier||subject} received`;
      const html = `<div style="font-family:Inter,sans-serif;padding:20px;border:1px solid #e8ddd0"><h2>Ticket #${ticketNo} received</h2><p>${name} 様、${tier? tier+' Fan Card' : subject} のお申し込みありがとうございます。</p><p>Management が24時間以内にチャットでご案内します。</p><p><a href="https://celebritypage.vercel.app/support/">View ticket →</a></p></div>`;
      return sendDirect({to: email, subject: subj, html, tag:'ticket'});
    },
    async booking({email, name, type, date}){
      const subj = `【Booking】${type} on ${date} — received`;
      const html = `<div style="font-family:Inter,sans-serif;padding:20px;border:1px solid #e8ddd0"><h2>Booking ${type} — ${date}</h2><p>${name} 様、リクエストを受け付けました。Adminがチャットで詳細をご案内します。</p></div>`;
      return sendDirect({to: email, subject: subj, html, tag:'booking'});
    },
    async passwordReset({email}){
      const subj = `【Takuya Kimura Official】Password reset`;
      const html = `<div style="padding:20px"><p>${email} 様、パスワードリセットのご案内です。ログイン画面から再設定してください。</p></div>`;
      return sendDirect({to: email, subject: subj, html, tag:'password-reset'});
    }
  };
  console.info('[EmailNotify] ready — backend:', !!window.KimuraDB?.apiBase, 'EmailJS:', !!CFG.emailjs?.enabled);
})();
