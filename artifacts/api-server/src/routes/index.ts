import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import authRouter from "./auth";
import healthRouter from "./health";
import tasksRouter from "./tasks";
import budgetRouter from "./budget";
import calendarRouter from "./calendar";
import reservesRouter from "./reserves";
import reviewsRouter from "./reviews";
import notesRouter from "./notes";
import weeklyPlansRouter from "./weekly-plans";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(requireAuth);
router.use(tasksRouter);
router.use(budgetRouter);
router.use(calendarRouter);
router.use(reservesRouter);
router.use(reviewsRouter);
router.use(notesRouter);
router.use(weeklyPlansRouter);

export default router;
