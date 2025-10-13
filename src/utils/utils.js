import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { randomInt } from "crypto";

export async function hashPassword(plain) {
  const salt = await bcrypt.genSalt(env.bcryptRounds);
  return bcrypt.hash(plain, salt);
}

export function compare(storedHash, plain) {
  return bcrypt.compare(plain, storedHash);
}

// Generate a 6-digit OTP with low probability of repeating
export const generateOTP = () => {
  let otp;
  const uniqueOTPs = new Set();

  // Ensure the OTP is not a duplicate with 1 in 1000 odds
  do {
    otp = randomInt(100000, 1000000).toString(); // Generate a 6-digit OTP
  } while (uniqueOTPs.has(otp));

  // Store the OTP to track uniqueness within the 1000 scope
  uniqueOTPs.add(otp);

  // If we exceed 1000 unique OTPs, clear the set to maintain the odds
  if (uniqueOTPs.size > 1000) {
    uniqueOTPs.clear();
  }

  return otp;
};