//src/routes/index.routes.js
import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import verificationRoutes from './verification.routes.js';
import apiKeyManagementRoutes from './api-key-management.routes.js';
const router = Router();

router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/verification', verificationRoutes);
router.use('/api-key-management', apiKeyManagementRoutes);

export default router;
