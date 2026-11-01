/**
 * 新增两条镜牢饰品（2026-11-01，用户手动核对数据）：
 *   奉纳的雪茄 IV 怠惰 390 — 特定卡包：教材
 *   翼形蜡烛   III 暴怒 250 — 特定卡包：解放的暴怒 / 盛火时节
 *
 * 用法：node tools/add_relics_20261101.js [--apply]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'relics.json');
const IMG_DIR = path.join(ROOT, 'resources', 'relics');
const SRC_DIR = 'D:\\Projects\\谨遵指令\\新增饰品手动获取26.11.1';
const APPLY = process.argv.includes('--apply');

const CIGAR_DESC = [
  '回合开始时，若属于拇指的人格不低于3名，则触发该效果(以参战人员为基准)',
  '回合开始时，使属于拇指的人格获得1层加算硬币强化与2层伤害强化',
  '每有1名属于拇指的人格，使全体属于拇指的人格获得1层攻击等级提升(最多4层)',
  '目标每带有1级震颤-灼热强度，使自身造成的伤害+1%(最多+20%)',
  '- 消耗弹药的技能造成的伤害额外+1%(最多+20%)',
  '- 属于拇指的人格造成的伤害额外+1%(最多+20%)',
  '',
  '自身的技能触发震颤引爆时，下回合使自身获得2层攻击等级提升(每回合最多3次)',
  '',
  '蜘蛛巢 拇指 父辈 罗佳3技能攻击后，使蜘蛛巢 拇指 子辈 希斯克利夫获得1层逐渐完备的教材',
].join('\n');

const CANDLE_DESC = [
  '回合开始时，若属于黎明事务所的人格不低于3名，则触发该效果(以编队人员为基准)',
  '首个回合开始时，使全体友方单位获得2层迎接黎明',
  '战斗开始时，使黎明事务所 收尾人 辛克莱恢复10点理智值，该人格通过被动“不稳定的自我外壳”进入不稳定E.G.O::蜡翼状态的理智值条件改为不低于25点',
  '',
  '[属于黎明事务所的人格专属]',
  '基础技能攻击命中时，使目标增加2级烧伤强度与2级震颤强度(每个技能最多1次)',
  '',
  '属于黎明事务所的人格视作施加烧伤与震颤的人格',
  '- 属于黎明事务所的人格的基础技能视作施加烧伤与震颤的技能',
  '关卡开始时，若黎明事务所 收尾人 浮士德在场，则使其获得1层战斗直觉',
].join('\n');

const NEW_RELICS = [
  {
    id: 'fengnadexueqie',
    name: '奉纳的雪茄',
    tier: 'IV',
    image: 'resources/relics/fengnadexueqie.png',
    srcPng: '奉纳的雪茄.png',
    tags: { effect: ['震颤'], sinAffinity: ['怠惰'] },
    price: 390,
    acquisition: '[卡包] 教材',
    source: { type: 'cardpack', name: '教材', url: null },
    enhancement: {
      maxLevel: 0,
      levels: [
        {
          level: 0,
          label: '初始',
          description: CIGAR_DESC,
          tags: ['加算硬币强化', '伤害强化', '攻击等级提升', '震颤-灼热', '弹药', '震颤引爆', '逐渐完备的教材'],
        },
      ],
    },
  },
  {
    id: 'yixinglazhu',
    name: '翼形蜡烛',
    tier: 'III',
    image: 'resources/relics/yixinglazhu.png',
    srcPng: '翼形蜡烛.png',
    tags: { effect: ['烧伤', '震颤'], sinAffinity: ['暴怒'] },
    price: 250,
    acquisition: '[卡包] 解放的暴怒 / 盛火时节',
    source: { type: 'cardpack', name: '解放的暴怒 / 盛火时节', url: null },
    enhancement: {
      maxLevel: 0,
      levels: [
        {
          level: 0,
          label: '初始',
          description: CANDLE_DESC,
          tags: ['烧伤', '震颤', '迎接黎明', '战斗直觉'],
        },
      ],
    },
  },
];

function main() {
  const list = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const byId = new Map(list.map((r) => [r.id, r]));
  const byName = new Map(list.map((r) => [r.name, r]));
  let added = 0;
  let updated = 0;

  for (const item of NEW_RELICS) {
    const { srcPng, ...relic } = item;
    const exists = byId.get(relic.id) || byName.get(relic.name);
    if (exists) {
      Object.assign(exists, relic);
      updated++;
      console.log(`更新：${relic.name}（${relic.id}）`);
    } else {
      list.push(relic);
      added++;
      console.log(`新增：${relic.name}（${relic.id}）tier=${relic.tier} ${relic.price} 经费`);
    }
    const src = path.join(SRC_DIR, srcPng);
    const dst = path.join(IMG_DIR, `${relic.id}.png`);
    if (!fs.existsSync(src)) {
      console.log(`  ⚠ 源图缺失：${src}`);
      continue;
    }
    if (APPLY) {
      fs.copyFileSync(src, dst);
      console.log(`  ✓ 图标 -> resources/relics/${relic.id}.png`);
    } else {
      console.log(`  (dry) 图标 ${srcPng} -> resources/relics/${relic.id}.png`);
    }
  }

  if (APPLY) {
    fs.writeFileSync(DATA, JSON.stringify(list, null, 2), 'utf8');
    console.log(`\n已写入 data/relics.json，共 ${list.length} 条（新增 ${added} / 更新 ${updated}）`);
  } else {
    console.log(`\n(dry run) 预计 ${list.length} 条（新增 ${added} / 更新 ${updated}），加 --apply 执行`);
  }
}

main();
