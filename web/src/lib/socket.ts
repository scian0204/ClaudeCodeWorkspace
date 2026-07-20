import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
export function getSocket(): Socket {
  if (!socket) socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
  return socket;
}
