import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tasksRouter from "./tasks";
import budgetRouter from "./budget";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tasksRouter);
router.use(budgetRouter);

export default router;
