import { Router, type Request, type Response, type NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { z } from 'zod';
import { OurWork } from '../models/our-work.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import { readLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { uploadImage, MAX_UPLOAD_BYTES } from '../services/media/cloudinary.js';
import { badRequest } from '../utils/errors.js';

const router = Router();
const imageUploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 } });

function runImageUpload(req: Request, res: Response, next: NextFunction): void {
  imageUploader.array('files', 10)(req, res, (err) => {
    if (err instanceof MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(badRequest('Har image 5MB se choti honi chahiye.'));
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return next(badRequest('Ek saath max 10 images upload kar sakte hain.'));
      return next(badRequest('Upload fail hua - file dobara try karein.'));
    }
    next(err);
  });
}

const imageSchema = z.object({
  url: z.string().url().max(500),
  publicId: z.string().max(300).default(''),
  width: z.number().int().min(0).max(10000).default(0),
  height: z.number().int().min(0).max(10000).default(0),
  order: z.number().int().min(0).max(1000).default(0),
}).strict();

const submissionSchema = z.object({
  title: z.string().trim().max(140).default(''),
  description: z.string().max(4000).default(''),
  customerName: z.string().trim().max(80).default(''),
  rating: z.number().int().min(1).max(10).nullable().default(null),
  feedback: z.string().max(2000).default(''),
  images: z.array(imageSchema).min(1).max(10),
}).strict();

router.get('/our-work', readLimiter, async (_req: Request, res: Response) => {
  const items = await OurWork.find({ status: 'APPROVED', isPublished: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  res.json({ items });
});

router.post('/our-work/upload', writeLimiter, runImageUpload, async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) throw badRequest('Koi image select nahi hui.');
  const uploaded = await Promise.all(files.map(async (file, index) => {
    const result = await uploadImage(file.buffer, 'our-work');
    return { url: result.url, publicId: result.publicId, width: result.width, height: result.height, order: index };
  }));
  res.json({ files: uploaded });
});

router.post('/our-work/feedback', writeLimiter, validate({ body: submissionSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof submissionSchema>>).validated.body;
  const feedback = await OurWork.create({ ...body, source: 'CUSTOMER', status: 'PENDING', isPublished: false, isDemo: false, aiGenerated: false, submittedBy: req.auth?.userId ?? null });
  res.status(201).json({ feedback: { id: String(feedback._id), status: feedback.status } });
});

export default router;
