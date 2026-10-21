"""
Email notification service for TradeMind.

Provides SMTP-based email sending for deal notifications,
new session alerts, and API key alerts.
"""
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
import structlog

logger = structlog.get_logger(__name__)


class EmailService:
    """Handles sending transactional emails via SMTP."""

    def __init__(
        self,
        smtp_host: str,
        smtp_port: int,
        smtp_user: str,
        smtp_password: str,
        from_email: str,
        from_name: str = "TradeMind",
        use_tls: bool = True,
    ):
        self.smtp_host = smtp_host
        self.smtp_port = smtp_port
        self.smtp_user = smtp_user
        self.smtp_password = smtp_password
        self.from_email = from_email
        self.from_name = from_name
        self.use_tls = use_tls

    def _connect(self):
        """Create SMTP connection."""
        if self.use_tls:
            context = ssl.create_default_context()
            server = smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=10)
            server.starttls(context=context)
        else:
            server = smtplib.SMTP_SSL(self.smtp_host, self.smtp_port, timeout=10)
        server.login(self.smtp_user, self.smtp_password)
        return server

    def _build_message(self, to_email: str, subject: str, html_body: str) -> MIMEMultipart:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{self.from_name} <{self.from_email}>"
        msg["To"] = to_email
        msg.attach(MIMEText(html_body, "html"))
        return msg

    def send(self, to_email: str, subject: str, html_body: str) -> bool:
        """Send an email. Returns True on success."""
        try:
            msg = self._build_message(to_email, subject, html_body)
            server = self._connect()
            server.sendmail(self.from_email, to_email, msg.as_string())
            server.quit()
            logger.info("email_sent", to=to_email, subject=subject)
            return True
        except Exception as e:
            logger.error("email_send_failed", to=to_email, error=str(e))
            return False


# ── Email Templates ──────────────────────────────────────────────

_BASE_STYLE = """
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
  .container { max-width: 600px; margin: 20px auto; background: #fff; border: 3px solid #001524; }
  .header { background: #001524; color: #FFECD1; padding: 24px 32px; }
  .header h1 { margin: 0; font-size: 22px; letter-spacing: 1px; }
  .header .accent { color: #FF7D00; }
  .body { padding: 32px; color: #001524; line-height: 1.6; }
  .stat-row { display: flex; gap: 16px; margin: 16px 0; }
  .stat-box { flex: 1; background: #FFECD1; border: 2px solid #001524; padding: 12px 16px; text-align: center; }
  .stat-box .label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #555; }
  .stat-box .value { font-size: 24px; font-weight: 700; color: #001524; }
  .btn { display: inline-block; background: #15616D; color: #fff; padding: 12px 28px; text-decoration: none; font-weight: 700; border: 2px solid #001524; margin-top: 16px; }
  .footer { background: #f9f9f9; border-top: 2px solid #001524; padding: 16px 32px; font-size: 12px; color: #888; text-align: center; }
  .teal { color: #15616D; }
  .orange { color: #FF7D00; }
</style>
"""


def template_deal_notification(
    seller_name: str,
    product_name: str,
    outcome: str,
    final_price: float,
    original_price: float,
    buyer_name: str = "Customer",
    rounds: int = 0,
    session_id: str = "",
) -> tuple[str, str]:
    """Returns (subject, html_body) for a deal notification."""
    status_color = "#15616D" if outcome == "accepted" else "#78290F"
    status_label = "DEAL ACCEPTED" if outcome == "accepted" else "DEAL REJECTED"
    discount = round((1 - final_price / original_price) * 100, 1) if original_price else 0

    subject = f"{'✅' if outcome == 'accepted' else '❌'} {status_label} — {product_name}"
    html = f"""<!DOCTYPE html><html><head>{_BASE_STYLE}</head><body>
    <div class="container">
      <div class="header">
        <h1>TRADE<span class="accent">MIND</span></h1>
      </div>
      <div class="body">
        <p>Hi <strong>{seller_name}</strong>,</p>
        <p style="font-size:18px;font-weight:700;color:{status_color}">{status_label}</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px 0;color:#888">Product</td><td style="padding:8px 0;font-weight:600">{product_name}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Buyer</td><td style="padding:8px 0;font-weight:600">{buyer_name}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Original Price</td><td style="padding:8px 0">₹{original_price:,.2f}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Final Price</td><td style="padding:8px 0;font-weight:700;color:{status_color}">₹{final_price:,.2f}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Discount</td><td style="padding:8px 0">{discount}%</td></tr>
          <tr><td style="padding:8px 0;color:#888">Rounds</td><td style="padding:8px 0">{rounds}</td></tr>
        </table>
        <a href="#" class="btn">View in Dashboard</a>
      </div>
      <div class="footer">TradeMind Negotiation Platform &bull; Session {session_id[:8] if session_id else 'N/A'}</div>
    </div>
    </body></html>"""
    return subject, html


def template_new_session(
    seller_name: str,
    product_name: str,
    buyer_name: str = "Anonymous",
    session_id: str = "",
) -> tuple[str, str]:
    """Returns (subject, html_body) for a new session alert."""
    subject = f"🔔 New Negotiation Started — {product_name}"
    html = f"""<!DOCTYPE html><html><head>{_BASE_STYLE}</head><body>
    <div class="container">
      <div class="header">
        <h1>TRADE<span class="accent">MIND</span></h1>
      </div>
      <div class="body">
        <p>Hi <strong>{seller_name}</strong>,</p>
        <p>A new negotiation session has started for your product.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px 0;color:#888">Product</td><td style="padding:8px 0;font-weight:600">{product_name}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Buyer</td><td style="padding:8px 0">{buyer_name}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Session</td><td style="padding:8px 0;font-family:monospace">{session_id[:12] if session_id else 'N/A'}</td></tr>
        </table>
        <a href="#" class="btn">Open Dashboard</a>
      </div>
      <div class="footer">TradeMind Negotiation Platform</div>
    </div>
    </body></html>"""
    return subject, html


def template_api_key_created(
    user_name: str,
    key_label: str,
    key_preview: str,
) -> tuple[str, str]:
    """Returns (subject, html_body) for API key creation alert."""
    subject = "🔑 New API Key Created — TradeMind"
    html = f"""<!DOCTYPE html><html><head>{_BASE_STYLE}</head><body>
    <div class="container">
      <div class="header">
        <h1>TRADE<span class="accent">MIND</span></h1>
      </div>
      <div class="body">
        <p>Hi <strong>{user_name}</strong>,</p>
        <p>A new API key was just created on your account.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px 0;color:#888">Label</td><td style="padding:8px 0;font-weight:600">{key_label}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Key Preview</td><td style="padding:8px 0;font-family:monospace">{key_preview}</td></tr>
        </table>
        <p style="color:#78290F;font-weight:600">If you did not create this key, please revoke it immediately from the API Access page.</p>
      </div>
      <div class="footer">TradeMind Negotiation Platform</div>
    </div>
    </body></html>"""
    return subject, html


def template_api_key_revoked(
    user_name: str,
    key_label: str,
    key_preview: str,
) -> tuple[str, str]:
    """Returns (subject, html_body) for API key revocation alert."""
    subject = "🗑️ API Key Revoked — TradeMind"
    html = f"""<!DOCTYPE html><html><head>{_BASE_STYLE}</head><body>
    <div class="container">
      <div class="header">
        <h1>TRADE<span class="accent">MIND</span></h1>
      </div>
      <div class="body">
        <p>Hi <strong>{user_name}</strong>,</p>
        <p>An API key was just <span style="color:#78290F;font-weight:700">REVOKED</span> on your account.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px 0;color:#888">Label</td><td style="padding:8px 0;font-weight:600">{key_label}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Key Preview</td><td style="padding:8px 0;font-family:monospace">{key_preview}</td></tr>
        </table>
        <p style="color:#78290F;font-weight:600">If you did not revoke this key, please check your account security immediately.</p>
      </div>
      <div class="footer">TradeMind Negotiation Platform</div>
    </div>
    </body></html>"""
    return subject, html


def template_test_email(user_name: str) -> tuple[str, str]:
    """Returns (subject, html_body) for a test email."""
    subject = "✅ TradeMind — Email Configuration Test"
    html = f"""<!DOCTYPE html><html><head>{_BASE_STYLE}</head><body>
    <div class="container">
      <div class="header">
        <h1>TRADE<span class="accent">MIND</span></h1>
      </div>
      <div class="body">
        <p>Hi <strong>{user_name}</strong>,</p>
        <p style="font-size:18px;color:#15616D;font-weight:700">Your email is configured correctly! 🎉</p>
        <p>You will now receive notifications for:</p>
        <ul>
          <li>Deal outcomes (accepted/rejected)</li>
          <li>New negotiation sessions</li>
          <li>API key events</li>
        </ul>
      </div>
      <div class="footer">TradeMind Negotiation Platform</div>
    </div>
    </body></html>"""
    return subject, html
