import { compare } from '../utils/utils.js';
import {
  ERROR_USER_NOT_FOUND,
  ERROR_PASSWORD_INCORRECT,
  REGISTER_SUCCESS,
  ERROR_USER_EXISTS,
  ERROR_OTP_INVALID
} from '../constants/auth.constant.js';
import { findActiveUserByEmail, registerUser, updateOTP, markAsVerified, updatePassword } from '../services/auth.service.js';
import { hashPassword, generateOTP } from '../utils/utils.js';
import { sendEmailVerification, sendResetPasswordOtp } from '../services/email.service.js';

export async function login(req, res) {
  const { email, password } = req.body;

  let user = await findActiveUserByEmail(email);
  if (!user) {
    return res.status(401).json({ success: false, message: ERROR_USER_NOT_FOUND });
  }

  const isMatch = await compare(user.password , password);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: ERROR_PASSWORD_INCORRECT });
  }

  if(!user.isVerifiedUser) {
    const otp = generateOTP();
    await sendResetPasswordOtp(email, otp);
    user = await updateOTP(email, otp);
    return res.status(401).json({ success: false, message: 'User is not verified' });
  }

  delete user.password;
  delete user.currentOtp;

  return res.json({ success: true, data: user });
}

export async function register(req, res) {
  const { name, email, password } = req.body;

  let user;

  try {

    const otp = generateOTP();

    user = await findActiveUserByEmail(email);
    if(!user) {
      const passwordHash = await hashPassword(password);
      user = await registerUser(name, email, otp, passwordHash);
    } else if(user.isVerifiedUser) {
      return res.status(400).json({ success: false, message: ERROR_USER_EXISTS });
    } else {
      user = await updateOTP(email, otp);
    }
    
    const verification = await sendEmailVerification(email, otp);

    if(!verification) {
      return res.status(500).json({ success: false, message: 'Failed to send verification email' });
    }
    delete user.passwordHash;
    delete user.currentOtp;
    
  } catch (error) {
    if(error.message.includes('duplicate key value violates unique constraint') && error.message.includes('User_Active_Email')) {
      return res.status(400).json({ success: false, message: ERROR_USER_EXISTS });
    }
    return res.status(400).json({ success: false, message: error.message });
  }
  
  return res.json({ success: true, data: user, message: REGISTER_SUCCESS });
}

export async function sendVerification(req, res) {
  const { email, type } = req.body;

  if(!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  if(type !== 'reset' && type !== 'verify') {
    return res.status(400).json({ success: false, message: 'Invalid type' });
  }
  let user;
  try {
    const otp = generateOTP();

    user = await findActiveUserByEmail(email);
    if (!user) {
      return res.status(401).json({ success: false, message: ERROR_USER_NOT_FOUND });
    }
    if(type === 'reset' && !user.isVerifiedUser) {
      return res.status(401).json({ success: false, message: 'User is not verified' });
    }

    let verification;

    if(type === 'reset') {
      verification = await sendResetPasswordOtp(email, otp);
    } 

    if(type === 'verify') {
      verification = await sendEmailVerification(email, otp);
    }
    if(!verification) {
      return res.status(500).json({ success: false, message: 'Failed to send verification email' });
    }
    user = await updateOTP(email, otp);
    delete user.passwordHash;
    delete user.currentOtp;

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
  return res.json({ success: true, data: user });
}

export async function verify(req, res) {
  const { email, otp } = req.body;

  let user = await findActiveUserByEmail(email);
  if (!user) {
    return res.status(401).json({ success: false, message: ERROR_USER_NOT_FOUND });
  }
  if (user.currentOtp !== otp.toString().trim()) {
    return res.status(401).json({ success: false, message: ERROR_OTP_INVALID });
  }

  user = await markAsVerified(user.userId);
  delete user.passwordHash;
  delete user.currentOtp;

  user = {
    ...user,
    hashOtp: await hashPassword(otp.toString())
  }

  return res.json({ success: true, data: user });
}

export async function resetPassword(req, res) {
  const { email, hashOtp, password } = req.body;

  if(!password || password.length === 0) {
    return res.status(401).json({ success: false, message: "Password is required" });
  }

  let user = await findActiveUserByEmail(email);
  if (!user) {
    return res.status(401).json({ success: false, message: ERROR_USER_NOT_FOUND });
  }

  const isMatch = await compare(hashOtp, user.currentOtp);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: "Please request a new OTP" });
  }

  user = await updatePassword(user.userId, await hashPassword(password.toString()));
  delete user.passwordHash;
  delete user.currentOtp;

  return res.json({ success: true, data: user });
}