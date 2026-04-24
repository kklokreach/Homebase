import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tasksRouter from "./tasks";
import budgetRouter from "./budget";
import calendarRouter from "./calendar";
import reservesRouter from "./reserves";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tasksRouter);
router.use(budgetRouter);
router.use(calendarRouter);
router.use(reservesRouter);

export default router;
