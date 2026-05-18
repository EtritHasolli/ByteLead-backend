import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendPasswordResetEmail(toEmail: string, resetUrl: string) {
  await transporter.sendMail({
    from: `"ByteLead" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: "Reset your ByteLead password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#0ea5e9">Reset your password</h2>
        <p>Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
        <a href="${resetUrl}" style="display:inline-block;margin:16px 0;padding:12px 24px;background:#0ea5e9;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
          Reset Password
        </a>
        <p style="color:#888;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
        <p style="color:#888;font-size:12px">Or copy this link: ${resetUrl}</p>
      </div>
    `,
  });
}
