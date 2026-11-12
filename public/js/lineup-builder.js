(function (global) {
  'use strict';

  function eligiblePositions(slotType, sport) {
    var slot = String(slotType || '').toUpperCase().replace(/\s+/g, '');
    if (sport === 'nfl') {
      if (slot === 'QB') return ['QB'];
      if (slot === 'RB') return ['RB', 'FB'];
      if (slot === 'WR') return ['WR'];
      if (slot === 'TE') return ['TE'];
      if (slot === 'K' || slot === 'PK') return ['K', 'PK'];
      if (slot === 'D/ST' || slot === 'DST' || slot === 'DEF') return ['D/ST', 'DST', 'DEF'];
      if (slot === 'FLEX') return ['RB', 'FB', 'WR', 'TE'];
      if (slot === 'OP' || slot === 'SUPERFLEX') return ['QB', 'RB', 'FB', 'WR', 'TE'];
    } else {
      if (slot === 'PG') return ['PG', 'G'];
      if (slot === 'SG') return ['SG', 'G'];
      if (slot === 'SF') return ['SF', 'F'];
      if (slot === 'PF') return ['PF', 'F'];
      if (slot === 'C') return ['C'];
      if (slot === 'G') return ['PG', 'SG', 'G'];
      if (slot === 'F') return ['SF', 'PF', 'F'];
      if (slot === 'UTIL' || slot === 'FLEX') return ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C'];
    }
    return [];
  }

  function score(player) {
    if (Number.isFinite(player.projectedPoints)) return player.projectedPoints;
    if (Number.isFinite(player.finalPoints)) return player.finalPoints;
    return 0;
  }

  function fallbackSlots(sport, roster) {
    if (sport === 'nfl') {
      var slots = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K'];
      if (roster.some(function (player) { return ['D/ST', 'DST', 'DEF'].includes(String(player.position).toUpperCase()); })) {
        slots.push('D/ST');
      }
      return slots;
    }
    return ['PG', 'SG', 'SF', 'PF', 'C', 'UTIL', 'UTIL', 'UTIL', 'UTIL', 'UTIL'];
  }

  function buildBestRosterLineup(roster, sport) {
    var players = Array.isArray(roster) ? roster : [];
    var seen = new Set();
    var available = players.filter(function (player) {
      var id = String(player.id || player.fullName);
      if (!id || seen.has(id) || player.slotType === 'IR') return false;
      seen.add(id);
      return true;
    });
    var slotTypes = players.filter(function (player) {
      return player.isStarter && player.slotType !== 'IR' && player.slotType !== 'BENCH';
    }).map(function (player) { return player.slotType; });
    if (!slotTypes.length) slotTypes = fallbackSlots(sport, players);

    var slots = slotTypes.map(function (slotType, index) {
      return { slotType: slotType, index: index, eligible: eligiblePositions(slotType, sport) };
    });
    var assignmentOrder = slots.slice().sort(function (a, b) {
      var aCount = available.filter(function (player) {
        return a.eligible.includes(String(player.position).toUpperCase());
      }).length;
      var bCount = available.filter(function (player) {
        return b.eligible.includes(String(player.position).toUpperCase());
      }).length;
      return aCount - bCount || a.index - b.index;
    });

    var used = new Set();
    var assigned = new Map();
    assignmentOrder.forEach(function (slot) {
      var candidate = available.filter(function (player) {
        return !used.has(String(player.id || player.fullName)) &&
          slot.eligible.includes(String(player.position).toUpperCase());
      }).sort(function (a, b) {
        return score(b) - score(a) || String(a.fullName).localeCompare(String(b.fullName));
      })[0];
      if (candidate) {
        used.add(String(candidate.id || candidate.fullName));
        assigned.set(slot.index, candidate);
      }
    });

    var starters = slots.map(function (slot) {
      var player = assigned.get(slot.index);
      return {
        slotType: slot.slotType,
        player: player ? Object.assign({}, player, {
          suggestedSlot: slot.slotType,
          suggestedStarter: true,
          is_starter: true
        }) : null
      };
    });
    var bench = players.filter(function (player) {
      return !used.has(String(player.id || player.fullName));
    }).map(function (player) {
      return Object.assign({}, player, {
        suggestedSlot: player.slotType === 'IR' ? 'IR' : 'BENCH',
        suggestedStarter: false,
        is_starter: false
      });
    });
    var projectionTotal = starters.reduce(function (sum, slot) {
      return sum + (slot.player && Number.isFinite(slot.player.projectedPoints) ? slot.player.projectedPoints : 0);
    }, 0);
    var projectedCount = starters.filter(function (slot) {
      return slot.player && Number.isFinite(slot.player.projectedPoints);
    }).length;

    return {
      slots: starters,
      bench: bench,
      projectionTotal: projectionTotal,
      projectedCount: projectedCount,
      filledCount: starters.filter(function (slot) { return Boolean(slot.player); }).length,
      slotCount: starters.length
    };
  }

  global.buildBestRosterLineup = buildBestRosterLineup;
})(typeof window === 'undefined' ? globalThis : window);
