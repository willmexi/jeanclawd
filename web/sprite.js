// Pixel Jean-Claude — the one true sprite definition for the web side.
// (JeanPet/Sources/JeanPet/JeanSprite.swift is a hand-port of this file:
// change both or the desktop pet and the web logo drift apart.)
// Canvas is 32×28 cells; the standing body is 16 wide and sits at x=8.
(function (global) {
  const PALETTE = {
    K: '#2A1A12', // outline
    H: '#1C1614', h: '#3A3230', // slicked-back black hair
    S: '#EBB78E', s: '#C99268', // skin
    O: '#1F1B1A', o: '#33302E', // black tank top
    P: '#3E5F8A', // blue jeans
    C: '#D97757', c: '#B35C3E', // Claude orange (the twin's tank)
    G: '#F2C14E', // belt buckle
    M: '#8C3A2A', // mouth
    W: '#FFFFFF',
    L: '#4F8A3E', // palm leaves
    B: '#3A3F5C', // truck cab
  };

  // rows 0-23: head → belt → top of pants (16 wide)
  const BODY = [
    '....KKKKKKKK....',
    '...KHHhhHHHHK...',
    '..KHHHHHHhHHHK..',
    '..KHHHHHHHHHHK..',
    '.KHHKSSSSSSKHHK.',
    '.KHHKSSSSSSKHHK.',
    '.KHHKSKSSKSKHHK.',
    '..KSKSSSSSSKSK..',
    '..KSKSSsSSSKSK..',
    '...KKSSSSSSKK...',
    '....KSMMMMSK....',
    '....KsSSSSsK....',
    '.....KKsSKK.....',
    '.....KKSSKK.....',
    '..KKKKKSSKKKKK..',
    '.KSSKOSSSSOKSSK.',
    'KSSSKOOSSOOKSSSK',
    'KSSSKOOooOOKSSSK',
    'KSsSKOOOOOOKSsSK',
    '.KSKKOOooOOKKSK.',
    '.KSK.KGGGGK.KSK.',
    '..K..KPPPPK..K..',
    '.....KPPPPK.....',
    '.....KPPPPK.....',
  ];
  const LEGS_TOGETHER = [
    '.....KPPKPPK....',
    '.....KPPKPPK....',
    '.....KPPKPPK....',
    '....KKKKKKKKK...',
  ];
  const LEGS_APART = [
    '.....KPPKPPK....',
    '....KPPK.KPPK...',
    '....KPPK..KPPK..',
    '...KKKK...KKKK..',
  ];
  const LEGS_SPLITS = [ // 32 wide — the famous one
    '..KKKKKKKKKKKKPPPPKKKKKKKKKKKK..',
    '.KPPPPPPPPPPPPPPPPPPPPPPPPPPPPK.',
    'KKKPPPPPPPPPPPPPPPPPPPPPPPPPPKKK',
    'KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK',
  ];
  const LEGS_KICK = [ // 24 wide, kick to the right
    '.....KPPKKKKKKKKKKKKKKKK',
    '.....KPPKPPPPPPPPPPPPPKK',
    '....KPPPKKKKKKKKKKKKKKK.',
    '....KKKKK...............',
  ];
  const HEAD = BODY.slice(0, 14);
  const TORSO = [ // rows 14-23, no arms
    '....KKKSSKKK....', '....KOOOOOOK....', '....KOOOOOOK....', '....KOOooOOK....', '....KOOOOOOK....',
    '....KOOooOOK....', '....KKGGGGKK....', '.....KPPPPK.....', '.....KPPPPK.....', '.....KPPPPK.....',
  ];
  const ARM_DOWN_L = ['..KK', '.KSS', 'KSSS', 'KSSS', 'KSsS', '.KSK', '.KSK', '..K.'];
  const ARM_OUT_L = ['KKKKKK', 'KSSSSS', 'KKKKKK'];
  const ARM_OUT_R = ['KKKKKK', 'SSSSSK', 'KKKKKK'];
  const ARM_SALUTE = ['KKK.', 'KSSK', 'KSSK', '.KSK', '.KSK', '.KSK', '.KSK', '.KSK', 'KKSK'];
  const FIST = ['KKK', 'KSK', 'KKK'];
  const TREE = ['.LLLL.', 'LLLLLL', 'LLhhLL', '.LhhL.', '..hh..', '..hh..', '..hh..', '..hh..', '..hh..', '..hh..', '..hh..', '..hh..', '.hhhh.'];
  const TRUCK_L = ['KKKKKKKK', 'KBBKOOOK', 'KWBKOOOK', '.KK..KK.'];
  const TRUCK_R = ['KKKKKKKK', 'KOOOKBBK', 'KOOOKBWK', '.KK..KK.'];
  const HAIR_LONG = ['HH...', 'HHH..', 'HHHH.', 'HHHHH', 'HHHH.', 'HHH..', 'HH...', 'H....'];
  const HAIR_SHORT = ['H....', 'HH...', 'HH...', 'HHH..', 'HH...', 'HH...', 'H....', '.....'];

  const mirrorRow = r => r.split('').reverse().join('');
  const SEATED = ['....KPPPPPPPK...', '....KPPKKKPPK...', '....KKK...KKK...'];
  const UPPER_ARM = ['KSK', 'KSK', 'KSK', 'KSK'];
  const FOREARM = ['KSSSSSK', 'KKKKKKK'];
  const ARM_SIP = ['.KKK', 'KSSK', 'KSK.', 'KSK.', 'KSK.', 'KSK.', '.KK.'];
  const MUG = ['.W.W.', 'KKKKK', 'KWWWKK', 'KWWWK.', 'KKKKK'];

  const W = 32, H = 28;
  function blank() { return Array.from({ length: H }, () => Array(W).fill(null)); }
  function blit(grid, rows, x, y, map = {}) {
    rows.forEach((row, r) => { for (let c = 0; c < row.length; c++) {
      const ch = row[c]; if (ch !== '.' && y + r >= 0 && y + r < H && x + c >= 0 && x + c < W) grid[y + r][x + c] = map[ch] || ch;
    } });
  }
  function closedEyes(grid, y) { grid[y + 6][8 + 6] = 'S'; grid[y + 6][8 + 9] = 'S'; grid[y + 7][8 + 6] = 'K'; grid[y + 7][8 + 9] = 'K'; }

  function frame(name) {
    const g = blank();
    const standing = (x = 8, y = 0) => { blit(g, BODY, x, y); blit(g, LEGS_TOGETHER, x, y + 24); };
    switch (name) {
      case 'walkA': blit(g, BODY, 8, 0); blit(g, LEGS_APART, 8, 24); break;
      case 'walkB': blit(g, BODY, 8, 1); blit(g, LEGS_TOGETHER.slice(1), 8, 25); break;
      case 'talk': standing(); for (let c = 14; c <= 17; c++) g[10][c] = 'K'; break;
      case 'sleep': standing(); closedEyes(g, 0); break;
      // --- stunts from the films ---
      case 'splits': blit(g, BODY.slice(0, 21), 8, 4); blit(g, LEGS_SPLITS, 0, 24); g[14][14] = 'K'; g[14][17] = 'K'; break; // Bloodsport
      case 'epicSplit': blit(g, TRUCK_L, 0, 24); blit(g, TRUCK_R, 24, 24); blit(g, BODY.slice(0, 21), 8, 0); blit(g, LEGS_SPLITS, 0, 20); break; // Volvo
      case 'kick': blit(g, BODY, 8, 0); blit(g, LEGS_KICK, 8, 24); break; // kumite
      case 'treeKickA': blit(g, TREE, 26, 13); blit(g, BODY, 8, 0); blit(g, LEGS_KICK, 8, 24); break; // Kickboxer
      case 'treeKickB': blit(g, TREE, 26, 13); blit(g, BODY, 8, 0); blit(g, LEGS_APART, 8, 24); break;
      case 'danceA': blit(g, HEAD, 7, 0); blit(g, TORSO, 7, 14); blit(g, ARM_OUT_L, 5, 15); blit(g, ARM_OUT_R, 19, 15); blit(g, LEGS_APART, 7, 24); break; // Kickboxer bar
      case 'danceB': blit(g, HEAD, 9, 0); blit(g, TORSO, 9, 14); blit(g, ARM_OUT_L, 7, 14); blit(g, ARM_OUT_R, 21, 14); blit(g, LEGS_TOGETHER, 9, 24); break;
      case 'guardA': blit(g, HEAD, 8, 0); blit(g, TORSO, 8, 14); blit(g, FIST, 9, 14); blit(g, FIST, 20, 14); g[15][12] = 'S'; g[15][19] = 'S'; blit(g, LEGS_APART, 8, 24); break; // Lionheart
      case 'guardB': blit(g, HEAD, 8, 1); blit(g, TORSO, 8, 15); blit(g, FIST, 9, 15); blit(g, FIST, 20, 15); g[16][12] = 'S'; g[16][19] = 'S'; blit(g, LEGS_APART.slice(1), 8, 25); break;
      case 'double': standing(0, 0); blit(g, BODY, 16, 0, { O: 'C', o: 'c' }); blit(g, LEGS_TOGETHER, 16, 24); break; // Double Impact
      case 'flashKickA': blit(g, BODY, 8, -6); blit(g, LEGS_KICK, 8, 18); break; // Street Fighter
      case 'flashKickB': blit(g, BODY, 8, -3); blit(g, LEGS_KICK, 8, 21); break;
      case 'salute': blit(g, HEAD, 8, 0); blit(g, TORSO, 8, 14); blit(g, ARM_DOWN_L, 8, 14); blit(g, ARM_SALUTE, 19, 6); blit(g, LEGS_TOGETHER, 8, 24); break; // Universal Soldier
      case 'mulletA': standing(); blit(g, HAIR_LONG, 23, 3); break; // Hard Target
      case 'mulletB': standing(); blit(g, HAIR_SHORT, 23, 3); break;
      // --- the Dojo (web only, not in the Swift port): desk work, coffee, the couch ---
      case 'typeA': case 'typeB': {
        const up = name === 'typeB' ? 1 : 0;
        blit(g, HEAD, 8, 0); blit(g, TORSO, 8, 14); blit(g, SEATED, 8, 24);
        blit(g, UPPER_ARM, 9, 15); blit(g, UPPER_ARM, 20, 15);
        blit(g, FOREARM, 9, 19); blit(g, FOREARM, 16, 19 - up);
        break;
      }
      case 'sit': case 'sitSleep':
        blit(g, BODY.slice(0, 24), 8, 0); blit(g, SEATED, 8, 24);
        if (name === 'sitSleep') closedEyes(g, 0);
        break;
      case 'coffeeA': // sip
        blit(g, HEAD, 8, 0); blit(g, TORSO, 8, 14); blit(g, ARM_DOWN_L, 8, 14);
        blit(g, ARM_SIP, 19, 12); blit(g, MUG, 16, 9); blit(g, LEGS_TOGETHER, 8, 24);
        break;
      case 'coffeeB': // hold
        blit(g, HEAD, 8, 0); blit(g, TORSO, 8, 14); blit(g, ARM_DOWN_L, 8, 14);
        blit(g, ARM_DOWN_L.map(mirrorRow), 20, 14); blit(g, MUG, 22, 19); blit(g, LEGS_TOGETHER, 8, 24);
        break;
      default: standing(); // idle
    }
    return g;
  }

  /** Draw a frame onto a canvas context at pixel scale s. */
  function draw(ctx, name, s, palette = PALETTE, mirror = false) {
    const g = frame(name);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const ch = g[r][c]; if (!ch) continue;
      ctx.fillStyle = palette[ch] || palette.K;
      const x = mirror ? (W - 1 - c) : c;
      ctx.fillRect(x * s, r * s, s, s);
    }
  }

  /** Tight bounding box of the standing pose, for cropping the logo. */
  const STAND_BOX = { x: 8, y: 0, w: 16, h: 28 };

  global.JeanSprite = { PALETTE, frame, draw, W, H, STAND_BOX };
})(window);
