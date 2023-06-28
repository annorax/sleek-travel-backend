import { User } from "@prisma/client";
import { createTransport } from "nodemailer";
import { createEmailVerificationToken } from "./auth";

const transport = createTransport({
    host: <string>process.env.SMTP_ENDPOINT_URL,
    port: parseInt(<string>process.env.SMTP_ENDPOINT_PORT),
    secure: true,
    auth: {
      user: <string>process.env.SMTP_USERNAME,
      pass: <string>process.env.SMTP_PASSWORD
    }
});

export async function sendEmailVerificationRequest(user:User):Promise<void> {
    const url = `${<string>process.env.CLIENT_BASE_URL}/verify-email?token=${createEmailVerificationToken(user)}`;
    await transport.sendMail({
        from: "Slim Travel <noreply@slim.travel>",
        to: `${user.name} <${user.email}>`,
        subject: "Account Activation",
        text: `Simply visit ${url} to verify your email address and activate your account.`,
        html: `Simply click <a href="${url}">this link</a> to verify your email address and activate your account.`
    });
}