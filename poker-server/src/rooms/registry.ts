/**
 * In-memory registry of active rooms keyed by room id.
 *
 * Owns the lifetime of every Room — `create()` allocates and persists,
 * `delete()` hard-closes if not already and removes from the map.
 */

import { Room, persistNewRoom } from './room.js';
import { scoped } from '../log.js';

const log = scoped('registry');

class RoomRegistry {
  private rooms = new Map<string, Room>();

  size(): number {
    return this.rooms.size;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  set(id: string, room: Room): void {
    this.rooms.set(id, room);
  }

  delete(id: string): void {
    const r = this.rooms.get(id);
    if (r && !r.closed) r.hardClose();
    this.rooms.delete(id);
  }

  all(): Room[] {
    return Array.from(this.rooms.values());
  }

  /** Allocate a new room in memory + persist its initial state.
   *
   *  Members are inserted into `room.members` as INACTIVE placeholders
   *  with a no-op send — they're activated when the actual socket sends
   *  `join-room`, which calls `room.attachMember` with the live `send`.
   */
  create(
    roomId: string,
    gameKind: 'poker' | 'blackjack',
    seatCount: number,
    initialMembers: Array<{ pubkey: string; seat: number }>,
  ): Room {
    persistNewRoom(roomId, gameKind, seatCount, initialMembers);
    const room = new Room(roomId, gameKind, seatCount);
    this.rooms.set(roomId, room);
    for (const m of initialMembers) {
      room.members.set(m.pubkey, {
        pubkey: m.pubkey,
        socketId: '',
        seat: m.seat,
        send: () => { /* no live socket yet */ },
        active: false,
      });
    }
    log.info({ roomId, gameKind, seatCount, members: initialMembers.map(m => m.pubkey) }, 'room created');
    return room;
  }

  /** Find a room that has the given pubkey as a (possibly inactive) member. */
  findRoomByMember(pubkey: string): Room | undefined {
    for (const r of this.rooms.values()) {
      if (r.members.has(pubkey)) return r;
    }
    return undefined;
  }
}

let instance: RoomRegistry | null = null;

export function getRoomRegistry(): RoomRegistry {
  if (!instance) instance = new RoomRegistry();
  return instance;
}

/** Test helper — wipe registry between tests. */
export function resetRoomRegistry(): void {
  instance = null;
}
