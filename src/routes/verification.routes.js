//src/routes/verification.routes.js
/**
 * @openapi
 * tags:
 *   name: Verification
 *   description: API for verification
 */
import { Router } from 'express';
import { asyncHandler } from '../middlewares/async.js';
import { getVerification, verifyPSA, verifyOCR, getVerificationList } from '../controllers/verification.controller.js';
import fs from "fs/promises";
import multer from "multer";
import path from "path";
import { query } from "express-validator";

const router = Router();

// Ensure ./uploads exists
const uploadDir = path.join(process.cwd(), "uploads");
await fs.mkdir(uploadDir, { recursive: true }).catch(() => {});

// Multer (disk) for image uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const ext = path.extname(file.originalname) || ".bin";
    cb(null, `${ts}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const ok = /image\/(png|jpeg|jpg|webp|gif)/i.test(file.mimetype);
    cb(ok ? null : new Error("Unsupported file type"), ok);
  },
});


/**
 * @openapi
 * /api/verification/list:
 *   get:
 *     tags: [Verification]
 *     summary: Get verificationfrom user
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by user verification
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of items per page (default 10)
 *       - in: query
 *         name: pageIndex
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Page index starting from 0 (default 0)
 *     responses:
 *       200:
 *         description: Verification data from user
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
 */
router.get(
  "/list",
  [
    query("userId")
      .optional()
      .isInt().withMessage("userId must be a number"),

    query("pageSize")
      .optional()
      .isInt({ min: 1, max: 100 }).withMessage("pageSize must be between 1 and 100")
      .toInt(),
    query("pageIndex")
      .optional()
      .isInt({ min: 0 }).withMessage("pageIndex must be 0 or greater")
      .toInt(),
  ],
  asyncHandler(getVerificationList)
);

/**
 * @openapi
 * /api/verification/{id}:
 *   get:
 *     tags: [Verification]
 *     summary: Get a verification by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The Verification id
 *     responses:
 *       200:
 *         description: Verification details
 */
router.get('/:id', asyncHandler(getVerification));


/**
 * @openapi
 * /api/verification/verify/psa:
 *   post:
 *     tags: [Verification]
 *     summary: Verify PSA
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - date
 *               - dob
 *               - pcn
 *               - pob
 *               - fn
 *               - ln
 *               - mn
 *               - s
 *               - sf
 *             properties:
 *               d:
 *                 type: string
 *               dob:
 *                 type: string
 *               pcn:
 *                 type: string
 *               pob:
 *                 type: string
 *               fn:
 *                 type: string
 *               ln:
 *                 type: string
 *               mn:
 *                 type: string
 *               s:
 *                 type: string
 *               sf:
 *                 type: string
 *     responses:
 *       200:
 *         description: Verification response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                 message:
 *                   type: string
 *       401:
 *         description: Invalid data
 */
router.post('/verify/psa', asyncHandler(verifyPSA));

/**
 * @openapi
 * /api/verification/verify/ocr:
 *   post:
 *     tags: [Verification]
 *     summary: Verify uploaded image via OCR and Extract structured fields from an uploaded image using Gemini (hardcoded rules)
 *     description: >
 *       Upload an image (PNG/JPG/WEBP/GIF). The server applies hardcoded extraction rules:
 *       - dateOfBirth in YYYY-MM-DD
 *       - placeOfBirth normalized to a valid Philippine location (city/municipality/province)
 *       - returns strict JSON with keys:
 *         type, id, name, firstName, middleName, lastName, sex, dateOfBirth, placeOfBirth, address, others
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *               userId:
 *                 type: string
 *                 description: The userId of the user
 *             required:
 *               - image
 *               - userId
 *     responses:
 *       200:
 *         description: Extracted fields (JSON)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     type:         { type: string }
 *                     id:           { type: string }
 *                     name:         { type: string }
 *                     firstName:    { type: string }
 *                     middleName:   { type: string }
 *                     lastName:     { type: string }
 *                     sex:          { type: string }
 *                     dateOfBirth:  { type: string, example: "1999-03-21" }
 *                     placeOfBirth: { type: string, example: "Quezon City, Metro Manila, Philippines" }
 *                     address:      { type: string }
 *                     others:       { type: string }
 *       400:
 *         description: Missing or invalid image
 *       500:
 *         description: Model or server error
 */
router.post("/verify/ocr", upload.single("image"), asyncHandler(verifyOCR));

export default router;
