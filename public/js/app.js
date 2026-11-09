/**
 * Draft & Field Hub - Frontend JavaScript
 * Phase 1: Sport switching, theme toggle
 * Phase 2: ESPN sync integration
 */

document.addEventListener('DOMContentLoaded', () => {
  // === Sport Switcher ===
  const sportTabs = document.querySelectorAll('.sport-tab');
  const nflLineup = document.getElementById('lineup-nfl');
  const nbaLineup = document.getElementById('lineup-nba');

  sportTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      sportTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const sport = tab.dataset.sport;
      nflLineup.classList.toggle('hidden', sport !== 'nfl');
      nbaLineup.classList.toggle('hidden', sport !== 'nba');
    });
  });

  // === Theme Toggle ===
  const themeToggle = document.getElementById('themeToggle');
  const savedTheme = localStorage.getItem('theme') || 'dark';
  
  if (savedTheme === 'light') {
    document.body.classList.add('light');
    themeToggle.textContent = '\u2600'; // Sun
  } else {
    themeToggle.textContent = '\u263D'; // Moon
  }

  themeToggle.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light');
    themeToggle.textContent = isLight ? '\u2600' : '\u263D';
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
  });

  // === ESPN Sync (Phase 2) ===
  const espnSyncForm = document.getElementById('espnSyncForm');
  const syncStatus = document.getElementById('syncStatus');
  const lineupNfl = document.getElementById('lineup-nfl');
  const lineupNba = document.getElementById('lineup-nba');

  espnSyncForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Get form values
    const leagueId = document.getElementById('leagueId').value.trim();
    const swid = document.getElementById('swid').value.trim();
    const espnS2 = document.getElementById('espnS2').value.trim();
    
    // Get current sport
    const activeSportTab = document.querySelector('.sport-tab.active');
    const sport = activeSportTab ? activeSportTab.dataset.sport : 'nfl';
    
    // Validate inputs
    if (!leagueId) {
      showSyncStatus('Please enter your ESPN League ID', 'error');
      return;
    }
    if (!swid) {
      showSyncStatus('Please enter your SWID token', 'error');
      return;
    }
    if (!espnS2) {
      showSyncStatus('Please enter your espn_s2 token', 'error');
      return;
    }
    
    // Show loading state
    showSyncStatus('Syncing with ESPN...', 'loading');
    const submitBtn = espnSyncForm.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Syncing...';
    submitBtn.disabled = true;
    
    try {
      const response = await fetch('/api/sync/espn', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leagueId,
          swid,
          espnS2,
          sport
        })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        // Successfully synced - update UI with roster data
        showSyncStatus(`Successfully synced ${data.league.name}!`, 'success');
        updateLineupWithRoster(data.roster, data.league.sport);
      } else {
        // Error from API
        showSyncStatus(data.error || 'Failed to sync roster', 'error');
      }
    } catch (error) {
      console.error('Sync error:', error);
      showSyncStatus('Network error - please check your connection', 'error');
    } finally {
      // Restore button state
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
    }
  });

  /**
   * Display sync status message
   */
  function showSyncStatus(message, type = 'info') {
    syncStatus.textContent = message;
    syncStatus.className = `sync-status sync-${type}`;
    
    // Clear message after 5 seconds if not error
    if (type !== 'error') {
      setTimeout(() => {
        if (syncStatus.textContent === message) {
          syncStatus.textContent = '';
          syncStatus.className = 'sync-status';
        }
      }, 5000);
    }
  }

  /**
   * Update lineup display with roster data from ESPN
   */
  function updateLineupWithRoster(roster, sport) {
    const lineup = sport === 'nfl' ? lineupNfl : lineupNba;
    const slots = lineup.querySelectorAll('.slot');
    
    // Reset all slots to empty
    slots.forEach(slot => {
      const playerSpan = slot.querySelector('.slot-player');
      if (playerSpan) {
        playerSpan.textContent = 'Empty';
      }
    });
    
    // Group players by position
    const playersByPosition = {};
    roster.forEach(player => {
      const pos = player.position || 'Unknown';
      if (!playersByPosition[pos]) {
        playersByPosition[pos] = [];
      }
      playersByPosition[pos].push(player);
    });
    
    // Map positions to slot indices for NFL
    const nflPositionOrder = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'D/ST', 'K'];
    
    // Map positions to slot indices for NBA
    const nbaPositionOrder = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'UTIL', 'UTIL'];
    
    const positionOrder = sport === 'nfl' ? nflPositionOrder : nbaPositionOrder;
    
    // Fill slots with players
    let slotIndex = 0;
    for (const expectedPos of positionOrder) {
      if (slotIndex >= slots.length) break;
      
      const slot = slots[slotIndex];
      const slotPos = slot.dataset.slot;
      
      // Find players for this position
      const players = playersByPosition[expectedPos] || [];
      
      if (players.length > 0) {
        // Use the first player for this position
        const player = players[0];
        const playerSpan = slot.querySelector('.slot-player');
        if (playerSpan) {
          playerSpan.textContent = `${player.fullName} (${player.team})`;
          playerSpan.title = `${player.position} - ${player.fullName}`;
        }
      }
      
      slotIndex++;
    }
    
    // Fill remaining slots with any remaining players
    const allPositions = Object.keys(playersByPosition);
    for (const pos of allPositions) {
      const players = playersByPosition[pos];
      for (let i = 1; i < players.length && slotIndex < slots.length; i++) {
        const slot = slots[slotIndex];
        const player = players[i];
        const playerSpan = slot.querySelector('.slot-player');
        if (playerSpan) {
          playerSpan.textContent = `${player.fullName} (${player.team})`;
          playerSpan.title = `${player.position} - ${player.fullName}`;
        }
        slotIndex++;
      }
    }
  }
});
