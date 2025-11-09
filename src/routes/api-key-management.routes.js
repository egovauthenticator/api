/**
 * @openapi
 * tags:
 *   name: API Key Management
 *   description: API for managing API keys
 *
 * components:
 *   parameters:
 *     UserIdHeader:
 *       in: header
 *       name: userId
 *       required: false
 *       schema:
 *         type: string
 *       description: >
 *         Per-user cache scope. In Node, headers are lowercased and accessible as
 *         `req.headers['userid']`.
 *       example: "1"
 */
import { Router } from 'express';
import { asyncHandler } from '../middlewares/async.js';
import { getAll, create, expired } from '../controllers/api-key-management.controller.js';

const router = Router();

/**
 * @openapi
 * /api/api-key-management/all:
 *   get:
 *     tags: [API Key Management]
 *     summary: Get list of all active API keys
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       email:
 *                         type: string
 *                       name:
 *                         type: string
 *                       apiKey:
 *                         type: string
 *                       usage:
 *                         type: string
 *                       active:
 *                         type: string
 */
router.get('/all', asyncHandler(getAll));

/**
 * @openapi
 * /api/api-key-management/:
 *   post:
 *     tags: [API Key Management]
 *     summary: Create a new API key
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - name
 *               - apiKey
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               name:
 *                 type: string
 *               apiKey:
 *                 type: string
 *     responses:
 *       200:
 *         description: API Key created
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
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     name:
 *                       type: string
 *                     apiKey:
 *                       type: string
 *                     usage:
 *                       type: string
 *                     active:
 *                       type: string
 *                 message:
 *                   type: string
 *       400:
 *         description: Invalid input or duplicate key
 */
router.post('/', asyncHandler(create));

/**
 * @openapi
 * /api/api-key-management/{id}/mark-expired:
 *   put:
 *     tags: [API Key Management]
 *     summary: Mark an API key as expired
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: API Key ID
 *     responses:
 *       200:
 *         description: API Key marked as expired
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
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     name:
 *                       type: string
 *                     apiKey:
 *                       type: string
 *                     usage:
 *                       type: string
 *                     active:
 *                       type: string
 *                 message:
 *                   type: string
 *       404:
 *         description: API Key not found
 *       400:
 *         description: Error processing request
 */
router.put('/:id/mark-expired', asyncHandler(expired));

export default router;
