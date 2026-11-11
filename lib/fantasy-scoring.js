const NFL_DEFAULT = [
  [3, 0.04], [4, 4], [20, -2], [19, -2],
  [25, 0.1], [26, 6], [42, 1], [43, 0.1], [44, 6],
  [23, 2], [27, 2], [45, 2]
];

const NFL_STANDARD = NFL_DEFAULT.filter(([statId]) => statId !== 42);

const NBA_DEFAULT = [
  [0, 1], [1, 4], [2, 4], [3, 2], [6, 1],
  [11, -2], [13, 2], [14, -1], [17, 1], [18, -1], [21, 1]
];

const STAT_IDS = {
  nfl: {
    passingAttempts: 1,
    completions: 2,
    passingCompletions: 2,
    passingYards: 3,
    passingTouchdowns: 4,
    interceptions: 20,
    fumblesLost: 19,
    rushingAttempts: 24,
    rushingYards: 25,
    rushingTouchdowns: 26,
    receptions: 42,
    receivingReceptions: 42,
    receivingYards: 43,
    receivingTouchdowns: 44,
    passingTwoPointConversions: 23,
    rushingTwoPointConversions: 27,
    receivingTwoPointConversions: 45,
    fieldGoalsMade1_19: 74,
    fieldGoalsMade20_29: 75,
    fieldGoalsMade30_39: 76,
    fieldGoalsMade40_49: 77,
    fieldGoalsMade50: 78,
    fieldGoalsMissed: 79,
    extraPointsMade: 80,
    extraPointsMissed: 81,
    kickReturnTouchdowns: 97,
    puntReturnTouchdowns: 98,
    pointsAllowed: 120
  },
  nba: {
    points: 0,
    blocks: 1,
    steals: 2,
    assists: 3,
    offensiveRebounds: 4,
    defensiveRebounds: 5,
    rebounds: 6,
    totalRebounds: 6,
    turnovers: 11,
    fieldGoalsMade: 13,
    fieldGoalsAttempted: 14,
    fieldGoalAttempts: 14,
    freeThrowsMade: 17,
    freeThrowsAttempted: 18,
    threePointFieldGoalsMade: 21,
    threePointersMade: 21,
    doubleDoubles: 42,
    tripleDoubles: 43
  }
};
const POSITION_IDS = {
  QB: 1, RB: 2, FB: 2, WR: 3, TE: 4, PK: 5, K: 5,
  PG: 1, SG: 2, SF: 3, PF: 4, C: 5, G: 6, F: 7
};

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseFloat(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitMadeAttempted(value) {
  const [made, attempted] = String(value ?? '').split('/');
  return [parseNumber(made), parseNumber(attempted)];
}

function cleanOverrides(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(item => ({
      position: Number(item.position ?? item.positionId ?? item.id),
      points: Number(item.points ?? item.value)
    })).filter(item => Number.isInteger(item.position) && Number.isFinite(item.points));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).slice(0, 20).flatMap(([position, setting]) => {
    const positionId = Number(position);
    const points = typeof setting === 'number'
      ? setting
      : Number(setting?.points ?? setting?.value ?? setting?.[0]?.points);
    return Number.isInteger(positionId) && Number.isFinite(points) ? [{ position: positionId, points }] : [];
  });
}

function mapGameLogStats(sport, names = [], values = []) {
  const output = {};
  names.forEach((name, index) => {
    output[name] = values[index];
  });

  if (sport === 'nfl') {
    const pass = output['completions/passingAttempts'];
    if (pass !== undefined) {
      const [completions, attempts] = splitMadeAttempted(pass);
      output.completions = completions;
      output.passingAttempts = attempts;
    }
    const fieldGoals = output['fieldGoalsMade/fieldGoalAttempts']
      || output['fieldGoalsMade-fieldGoalsAttempted'];
    if (fieldGoals !== undefined) {
      const [made] = splitMadeAttempted(fieldGoals);
      output.fieldGoalsMade = made;
    }
    const extraPoints = output['extraPointsMade/extraPointAttempts']
      || output['extraPointsMade-extraPointAttempts'];
    if (extraPoints !== undefined) {
      const [made, attempted] = splitMadeAttempted(extraPoints);
      output.extraPointsMade = made;
      output.extraPointAttempts = attempted;
      output.extraPointsMissed = Math.max(0, attempted - made);
    }
    for (const [key, id] of [
      ['fieldGoalsMade1_19-fieldGoalAttempts1_19', 'fieldGoalsMade1_19'],
      ['fieldGoalsMade20_29-fieldGoalAttempts20_29', 'fieldGoalsMade20_29'],
      ['fieldGoalsMade30_39-fieldGoalAttempts30_39', 'fieldGoalsMade30_39'],
      ['fieldGoalsMade40_49-fieldGoalAttempts40_49', 'fieldGoalsMade40_49'],
      ['fieldGoalsMade50-fieldGoalAttempts50', 'fieldGoalsMade50']
    ]) {
      if (output[key] !== undefined) {
        const [made, attempted] = splitMadeAttempted(output[key]);
        output[id] = made;
        output.fieldGoalsMissed = (output.fieldGoalsMissed || 0) + Math.max(0, attempted - made);
      }
    }
  } else {
    const fields = [
      ['fieldGoalsMade-fieldGoalsAttempted', 'fieldGoalsMade', 'fieldGoalsAttempted'],
      ['threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'threePointFieldGoalsMade', 'threePointFieldGoalsAttempted'],
      ['freeThrowsMade-freeThrowsAttempted', 'freeThrowsMade', 'freeThrowsAttempted']
    ];
    for (const [source, madeKey, attemptedKey] of fields) {
      if (output[source] === undefined) continue;
      const [made, attempted] = String(output[source]).split('-').map(parseNumber);
      output[madeKey] = made;
      output[attemptedKey] = attempted;
    }
    if (output.rebounds !== undefined) output.totalRebounds = output.rebounds;
    if (output.totalRebounds !== undefined) output.rebounds = output.totalRebounds;
  }
  return output;
}

function mapBoxScoreStats(sport, groups) {
  const output = {};
  for (const group of groups || []) {
    (group.keys || []).forEach((key, index) => {
      const value = group.stats?.[index];
      if (value === undefined) return;
      output[key] = value;
    });
  }
  if (sport === 'nfl') {
    const pass = output['completions/passingAttempts'];
    if (pass !== undefined) {
      const [completions, attempts] = splitMadeAttempted(pass);
      output.completions = completions;
      output.passingAttempts = attempts;
    }
    const kicking = output['fieldGoalsMade/fieldGoalAttempts'];
    if (kicking !== undefined) {
      const [made] = splitMadeAttempted(kicking);
      output.fieldGoalsMade = made;
    }
    const extraPoints = output['extraPointsMade/extraPointAttempts'];
    if (extraPoints !== undefined) {
      const [made, attempted] = splitMadeAttempted(extraPoints);
      output.extraPointsMade = made;
      output.extraPointAttempts = attempted;
      output.extraPointsMissed = Math.max(0, attempted - made);
    }
    for (const [key, id] of [
      ['fieldGoalsMade1_19-fieldGoalAttempts1_19', 'fieldGoalsMade1_19'],
      ['fieldGoalsMade20_29-fieldGoalAttempts20_29', 'fieldGoalsMade20_29'],
      ['fieldGoalsMade30_39-fieldGoalAttempts30_39', 'fieldGoalsMade30_39'],
      ['fieldGoalsMade40_49-fieldGoalAttempts40_49', 'fieldGoalsMade40_49'],
      ['fieldGoalsMade50-fieldGoalAttempts50', 'fieldGoalsMade50']
    ]) {
      if (output[key] !== undefined) {
        const [made, attempted] = splitMadeAttempted(output[key]);
        output[id] = made;
        output.fieldGoalsMissed = (output.fieldGoalsMissed || 0) + Math.max(0, attempted - made);
      }
    }
  } else {
    const fields = [
      ['fieldGoalsMade-fieldGoalsAttempted', 'fieldGoalsMade', 'fieldGoalsAttempted'],
      ['threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'threePointFieldGoalsMade', 'threePointFieldGoalsAttempted'],
      ['freeThrowsMade-freeThrowsAttempted', 'freeThrowsMade', 'freeThrowsAttempted']
    ];
    for (const [source, madeKey, attemptedKey] of fields) {
      if (output[source] === undefined) continue;
      const [made, attempted] = String(output[source]).split('-').map(parseNumber);
      output[madeKey] = made;
      output[attemptedKey] = attempted;
    }
    if (output.rebounds !== undefined) output.totalRebounds = output.rebounds;
    if (output.totalRebounds !== undefined) output.rebounds = output.totalRebounds;
  }
  return output;
}

function cleanScoringSettings(value) {
  const items = value?.scoringItems;
  if (!Array.isArray(items)) return null;
  const scoringItems = items.slice(0, 100).map(item => ({
    statId: Number(item.statId),
    points: Number(item.points),
    isReverseItem: Boolean(item.isReverseItem),
    pointsOverrides: cleanOverrides(item.pointsOverrides)
  })).filter(item => Number.isInteger(item.statId) && Number.isFinite(item.points));
  return scoringItems.length ? { scoringItems } : null;
}

function getScoringConfig(sport, scoringSettings) {
  const leagueSettings = cleanScoringSettings(scoringSettings);
  if (leagueSettings) return { scoringItems: leagueSettings.scoringItems, label: 'ESPN league settings', source: 'league' };
  const defaults = sport === 'nba' ? NBA_DEFAULT : NFL_DEFAULT;
  return {
    scoringItems: defaults.map(([statId, points]) => ({ statId, points, pointsOverrides: [] })),
    label: sport === 'nba' ? 'ESPN default NBA points' : 'ESPN default PPR',
    source: 'default'
  };
}

function scoreNamedStats(sport, namedStats = {}, scoringSettings, position = '') {
  const config = getScoringConfig(sport, scoringSettings);
  const ids = STAT_IDS[sport];
  const positionId = POSITION_IDS[String(position || '').toUpperCase()];
  let score = 0;
  for (const item of config.scoringItems) {
    const statName = Object.keys(ids).find(name => ids[name] === item.statId);
    if (!statName) continue;
    const override = item.pointsOverrides?.find(entry => entry.position === positionId);
    const pointsPerStat = override ? override.points : item.points;
    score += parseNumber(namedStats[statName]) * pointsPerStat;
  }

  if (sport === 'nfl' && config.source === 'default') {
    const distanceStats = ['fieldGoalsMade1_19', 'fieldGoalsMade20_29', 'fieldGoalsMade30_39', 'fieldGoalsMade40_49', 'fieldGoalsMade50'];
    if (distanceStats.some(key => namedStats[key] !== undefined)) {
      score += 3 * (parseNumber(namedStats.fieldGoalsMade1_19) + parseNumber(namedStats.fieldGoalsMade20_29) + parseNumber(namedStats.fieldGoalsMade30_39));
      score += 4 * parseNumber(namedStats.fieldGoalsMade40_49);
      score += 5 * parseNumber(namedStats.fieldGoalsMade50);
    } else {
      const made = parseNumber(namedStats.fieldGoalsMade);
      const longest = parseNumber(namedStats.longFieldGoalMade);
      score += (made * 3) + (longest >= 50 ? 1 : 0);
    }
    score += parseNumber(namedStats.extraPointsMade);
    score += 6 * (parseNumber(namedStats.kickReturnTouchdowns) + parseNumber(namedStats.puntReturnTouchdowns));
  }
  return Number.isFinite(score) ? score : null;
}

function scoreGameLog(sport, names, values, scoringSettings, position) {
  return scoreNamedStats(sport, mapGameLogStats(sport, names, values), scoringSettings, position);
}

function scoreBoxScore(sport, groups, scoringSettings, position) {
  return scoreNamedStats(sport, mapBoxScoreStats(sport, groups), scoringSettings, position);
}

function scoringLabel(sport, scoringSettings) {
  const config = getScoringConfig(sport, scoringSettings);
  if (config.source === 'default') return config.label;
  if (sport === 'nfl') {
    const reception = config.scoringItems.find(item => item.statId === 42);
    return reception?.points > 0 ? 'ESPN league PPR scoring' : 'ESPN league scoring';
  }
  return 'ESPN league scoring';
}

function scoringSignature(sport, scoringSettings) {
  const config = getScoringConfig(sport, scoringSettings);
  return `${sport}:${config.source}:${config.scoringItems.map(item => `${item.statId}=${item.points}:${JSON.stringify(item.pointsOverrides || [])}`).join(',')}`;
}

module.exports = {
  cleanScoringSettings,
  getScoringConfig,
  scoreGameLog,
  scoreBoxScore,
  scoringLabel,
  scoringSignature
};
