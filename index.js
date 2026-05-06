import 'dotenv/config';
import { createServer } from './src/server.js';

const port = Number.parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';

const { httpServer } = await createServer();

httpServer.listen(port, host, () => {
	console.log(`Lobby bot dashboard listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
});
