//src/routes/index.routes.js
import { Router } from 'express';
import authRoutes from './auth.routes.js';
import verificationRoutes from './verification.routes.js';
const router = Router();

router.use('/auth', authRoutes);
router.use('/verification', verificationRoutes);

export default router;
