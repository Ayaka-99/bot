const { concludeUncontestedWin } = require('./texasHoldemService');

async function runTest() {
  console.log('Testing No Flop, No Drop rule...');

  const mockDb = {
    get: (q, p, cb) => cb(null, { currentJades: 100000 }),
    run: (q, p, cb) => (cb ? cb(null) : undefined),
    all: (q, p, cb) => (cb ? cb(null, []) : undefined),
  };

  // Case 1: Pre-flop uncontested win (SB folds, BB wins)
  const sessionPreflop = {
    db: mockDb,
    stage: 'PRE_FLOP',
    isContinuous: true,
    pot: 187, // SB 62 + BB 125
    tableCap: 2500,
    seats: [
      { seatIndex: 1, userId: 'user1', username: '玩家 (BB)', isNpc: false, chips: 2375, totalBet: 125, isFolded: false },
      { seatIndex: 3, userId: 'topaz_npc', username: '托帕 (SB)', isNpc: true, chips: 2438, totalBet: 62, isFolded: true },
    ],
  };

  const winnerPreflop = sessionPreflop.seats[0];
  await concludeUncontestedWin(sessionPreflop, winnerPreflop);

  // Winner should get 187 with 0 tax
  // chips before win = 2375. After win = 2375 + 187 = 2562. Net profit = +62 (+2.5% Table Cap)
  console.log('Case 1 Winner chips:', winnerPreflop.chips);
  if (winnerPreflop.chips === 2562) {
    console.log('✅ Case 1 Passed: No Flop, No Drop (0% Tax) awarded 100% of pot (2562 chips)');
  } else {
    throw new Error(`Case 1 Failed: Expected 2562, got ${winnerPreflop.chips}`);
  }

  // Case 2: Post-flop uncontested win (stage is 'FLOP')
  const sessionFlop = {
    db: mockDb,
    stage: 'FLOP',
    isContinuous: true,
    pot: 200,
    tableCap: 2500,
    seats: [
      { seatIndex: 1, userId: 'user1', username: '玩家 (BB)', isNpc: false, chips: 2300, totalBet: 100, isFolded: false },
      { seatIndex: 3, userId: 'topaz_npc', username: '托帕 (SB)', isNpc: true, chips: 2400, totalBet: 100, isFolded: true },
    ],
  };

  const winnerFlop = sessionFlop.seats[0];
  await concludeUncontestedWin(sessionFlop, winnerFlop);

  // 5% tax of 200 = 10. netWinPool = 190. chips = 2300 + 190 = 2490.
  console.log('Case 2 Winner chips:', winnerFlop.chips);
  if (winnerFlop.chips === 2490) {
    console.log('✅ Case 2 Passed: Post-flop win charged 5% tax (2490 chips)');
  } else {
    throw new Error(`Case 2 Failed: Expected 2490, got ${winnerFlop.chips}`);
  }

  console.log('🎉 All No Flop, No Drop tests passed!');
}

runTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
