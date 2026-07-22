import { io, type Socket } from 'socket.io-client';
import { getDemoSocket } from '../demo/socket';

let socket: Socket | null = null;
export function getSocket(): Socket {
  if (import.meta.env.VITE_DEMO) return getDemoSocket();
  if (!socket) socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
  return socket;
}
