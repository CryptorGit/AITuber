import * as BattleStreamMod from '../../../../../../tools/pokemon-showdown/pokemon-showdown/sim/battle-stream';

export type ReplayRecord = {
  battle_id: string;
  format: string;
  seed: number;
  start_seed?: number[];
  p1_team: string;
  p2_team: string;
  p1_choices: string[];
  p2_choices: string[];
  expected_winner?: string;
  expected_turns?: number;
};

function splitFirst(str: string, delimiter: string, limit = 1) {
  const splitStr: string[] = [];
  while (splitStr.length < limit) {
    const delimiterIndex = str.indexOf(delimiter);
    if (delimiterIndex >= 0) {
      splitStr.push(str.slice(0, delimiterIndex));
      str = str.slice(delimiterIndex + delimiter.length);
    } else {
      splitStr.push(str);
      str = '';
    }
  }
  splitStr.push(str);
  return splitStr;
}

class ReplayPlayer {
  readonly name: 'p1' | 'p2';
  readonly stream: any;
  lastRequest: any = null;

  constructor(name: 'p1' | 'p2', stream: any) {
    this.name = name;
    this.stream = stream;
  }

  async start() {
    for await (const chunk of this.stream) {
      for (const line of String(chunk).split('\n')) {
        this.receiveLine(line);
      }
    }
  }

  receiveLine(line: string) {
    if (!line.startsWith('|')) return;
    const [cmd, rest] = splitFirst(line.slice(1), '|');
    if (cmd === 'request') {
      try {
        this.lastRequest = JSON.parse(rest);
      } catch {
        this.lastRequest = null;
      }
    }
  }

  choose(choice: string) {
    void this.stream.write(choice);
  }
}

function nowMs() {
  return Date.now();
}

export async function runReplay(record: ReplayRecord): Promise<{ winner: string | null; turns: number; ok: boolean }> {
  const BS: any = (BattleStreamMod as any).BattleStream ? (BattleStreamMod as any) : (BattleStreamMod as any).default;
  if (!BS?.BattleStream || !BS?.getPlayerStreams) {
    throw new Error('Failed to load Pokemon Showdown BattleStream exports');
  }

  const stream = new BS.BattleStream({ debug: false });
  const players = BS.getPlayerStreams(stream);

  const p1 = new ReplayPlayer('p1', players.p1);
  const p2 = new ReplayPlayer('p2', players.p2);

  let winner: string | null = null;
  let ended = false;
  let turns = 0;

  (async () => {
    for await (const chunk of players.spectator) {
      for (const line of String(chunk).split('\n')) {
        if (!line.startsWith('|')) continue;
        const parts = line.split('|');
        if (parts[1] === 'turn') turns = Number(parts[2] ?? turns);
        if (parts[1] === 'win') {
          winner = parts[2] ?? null;
          ended = true;
        }
        if (parts[1] === 'tie') {
          winner = null;
          ended = true;
        }
      }
    }
    ended = true;
  })().catch(() => {});

  void p1.start();
  void p2.start();

  const seedArr = record.start_seed && record.start_seed.length === 4
    ? record.start_seed
    : [record.seed, record.seed + 1, record.seed + 2, record.seed + 3];

  const startOptions = {
    formatid: record.format,
    seed: seedArr.join(','),
  };

  await stream.write(`>start ${JSON.stringify(startOptions)}\n`);
  await stream.write(`>player p1 ${JSON.stringify({ name: 'p1', team: record.p1_team })}\n`);
  await stream.write(`>player p2 ${JSON.stringify({ name: 'p2', team: record.p2_team })}\n`);

  const p1q = [...record.p1_choices];
  const p2q = [...record.p2_choices];

  const started = nowMs();
  const deadlineMs = started + 30_000;

  while (!ended) {
    if (nowMs() > deadlineMs) throw new Error('Replay timed out');

    const r1 = p1.lastRequest;
    const r2 = p2.lastRequest;

    if (r1?.wait) p1.lastRequest = null;
    if (r2?.wait) p2.lastRequest = null;

    if (r1 && !r1.wait) {
      const choice = p1q.shift();
      if (!choice) throw new Error('Replay ran out of p1 choices');
      p1.lastRequest = null;
      p1.choose(choice);
    }

    if (r2 && !r2.wait) {
      const choice = p2q.shift();
      if (!choice) throw new Error('Replay ran out of p2 choices');
      p2.lastRequest = null;
      p2.choose(choice);
    }

    await new Promise<void>((resolve) => setImmediate(resolve));
    if ((players.spectator as any).atEOF) {
      ended = true;
      break;
    }
  }

  const ok =
    (record.expected_winner == null || record.expected_winner === winner || (record.expected_winner === 'tie' && winner == null)) &&
    (record.expected_turns == null || record.expected_turns === turns);

  return { winner, turns, ok };
}
