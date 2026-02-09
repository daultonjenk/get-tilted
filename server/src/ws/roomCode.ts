const ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_LENGTH = 6;

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_LENGTH; i += 1) {
    code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
  }
  return code;
}
