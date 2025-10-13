//src/config/env.js
import dotenv from 'dotenv';
dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  httpsPort: Number(process.env.HTTPS_PORT || 3443),
  sslKey: process.env.SSL_KEY,
  sslCert: process.env.SSL_CERT,
  db: {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    name: process.env.DB_NAME,
    pass: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT || 5432),
    ssl: process.env.DB_SSL === 'true' || false,
  },
  bcryptRounds: Number(process.env.BCRYPT_SALT_ROUNDS || 10),
  ev: {
    evEmail: process.env.EV_EMAIL,
    evPass: process.env.EV_PASS,
    evAddress: process.env.EV_ADDRESS,
    evSubject: process.env.EV_SUBJECT,
    evResetSubject: process.env.EV_RESET_SUBJECT,
    evCompany: process.env.EV_COMPANY,
    evUrl: process.env.EV_URL,
    evTemplate: process.env.EV_TEMPLATE,
    evResetTemplate: process.env.EV_RESET_TEMPLATE,
    
  },
  google: {
    apiKey: process.env.GOOGLE_API_KEY,
    aiAPIKey: process.env.GOOGLE_AI_API_KEY,
  },
  verifier: {
    psaVerifyURL: process.env.PSA_VERIFY_URL || "https://verify.philsys.gov.ph/api/verify",
    cookieGrabberUrl: process.env.COOKIE_GRABBER_URL || "https://cookie-grabber-easy.vercel.app/api/grab?url=https%3A%2F%2Fverify.philsys.gov.ph",
    cookieTTLMS: Number(process.env.COOKIE_TTL_MS || 5 * 60 * 1000),
    verifyTTLMS: Number(process.env.VERIFY_TTL_MS || 2 * 60 * 1000),
    fetchTimeoutMS: Number(process.env.FETCH_TIMEOUT_MS || 15_000),
  }
};
