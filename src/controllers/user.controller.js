import {
  ERROR_USER_NOT_FOUND,
  ERROR_USER_EXISTS,
  CREATE_SUCCESS,
} from "../constants/user.constant.js";
import {
  getUserById,
  updateUser,
} from "../services/user.service.js";

export async function getUser(req, res) {
  const { userId } = req.params;
  if (!userId) {
    return res
      .status(400)
      .json({ success: false, message: "Missing userId params" });
  }
  let user = await getUserById(userId);
  if (!user) {
    return res
      .status(400)
      .json({ success: false, message: ERROR_USER_NOT_FOUND });
  }
  delete user.password;
  delete user.currentOtp;
  return res.json({ success: true, data: user });
}

export async function update(req, res) {
  const { userId } = req.params;
  const { name, email } = req.body;

  let user;

  try {
    user = await getUserById(userId);
    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: ERROR_USER_NOT_FOUND });
    }
    user = await updateUser(userId, name, email);
    delete user.password;
  } catch (error) {
    if (
      error.message.includes(
        "duplicate key value violates unique constraint"
      ) &&
      error.message.includes("User_Active_Email")
    ) {
      return res
        .status(400)
        .json({ success: false, message: ERROR_USER_EXISTS });
    }
    return res.status(400).json({ success: false, message: error.message });
  }

  return res.json({ success: true, data: user, message: CREATE_SUCCESS });
}