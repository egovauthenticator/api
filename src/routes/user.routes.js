/**
 * @openapi
 * tags:
 *   name: User
 *   description: API for user
 */
import { Router } from "express";
import { asyncHandler } from "../middlewares/async.js";
import { getUser, update } from "../controllers/user.controller.js";

const router = Router();

/**
 * @openapi
 * /api/user/{userId}:
 *   get:
 *     tags: [User]
 *     summary: Get a user by userId
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The id of the user
 *     responses:
 *       200:
 *         description: User details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     userId:
 *                       type: string
 *                     firstName:
 *                       type: string
 *                     lastName:
 *                       type: string
 *                     email:
 *                       type: string
 *                     birthDate:
 *                       type: string
 *                     phoneNumber:
 *                       type: string
 */
router.get("/:userId", asyncHandler(getUser));


/**
 * @openapi
 * /api/user/{userId}:
 *   put:
 *     tags: [User]
 *     summary: Update user
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The id of the user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: User successfully updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     userId:
 *                       type: string
 *                     name:
 *                       type: string
 *                     email:
 *                       type: string
 *                     departmentId:
 *                       type: string
 *       401:
 *         description: Invalid data
 */
router.put(
  "/:userId",
  asyncHandler(update)
);

export default router;
