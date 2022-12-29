import pino from "pino";
import path from 'node:path';

const logger = pino(
	{
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
                levelFirst: true,
                translateTime: 'yyyy-dd-mm, h:MM:ss TT',
                destination: (path.resolve('./logs/logger.log')),
            },
        },
    },
);
export default logger;