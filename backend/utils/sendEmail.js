import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendResetCode = async (email, code) => {
  const { data, error } = await resend.emails.send({
    from: "Smart Agriculture <onboarding@resend.dev>",
    to: [email],
    subject: "Password Reset Code",
    text: `Your password reset code is ${code}. It expires in 10 minutes.`,
    html: `
      <h2>Smart Agriculture</h2>
      <h3>Password Reset</h3>
      <h1>${code}</h1>
      <p>This code expires in 10 minutes.</p>
    `
  });

  if (error) {
    console.error("Resend error:", error);
    throw new Error("Email sending failed");
  }

  return data;
};