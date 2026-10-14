/**
 * 词牌格律库
 * ─────────────────────────────────────────────────────────────
 * 平仄符号：○ 平   ● 仄   ◐ 可平可仄（中）
 * 格律依龙榆生《唐宋词格律》通行体整理。
 * `p` = 平仄谱；`r` = 韵脚标记（true 表示与本词牌主韵同韵；
 *   换韵词牌用 'A'/'B'/'C'/'D' 分组，每组韵脚互不相通）。
 *
 * ⚠️ 说明：词牌多有「变体」（又一体）。本表取最通行的一体，
 *    个别句读与平仄在不同版本间存在差异，已在 description 中注明。
 */

export const STYLE_TAGS = ['婉约', '豪放', '清丽', '疏朗', '沉郁']

export const CIPAI = [
  {
    id: 'yijiangnan',
    name: '忆江南',
    alias: ['望江南', '江南好', '梦江南'],
    syllables: 27,
    sentenceCount: 5,
    styleTag: '清丽',
    rhymeType: '平',
    rhymeGroups: [{ key: true, type: '平' }],
    defaultBu: 'tan', // 覃谈部
    origin: '本名《谢秋娘》，唐李德裕为亡妓谢秋娘作。后因白居易词「能不忆江南」改今名。单调小令，最短的词牌之一。',
    description: '二十七字，五句三平韵。首句三字定调，中二句七言对仗最见工力，末句五字收束。宜写四时风物、怀人念远，短而余韵长。',
    highlights: '「日出江花红胜火，春来江水绿如蓝」——七言对仗是全词的骨。',
    masterpieces: [
      {
        title: '忆江南·江南好',
        author: '白居易',
        text: '江南好，风景旧曾谙。日出江花红胜火，春来江水绿如蓝。能不忆江南？'
      },
      {
        title: '望江南·梳洗罢',
        author: '温庭筠',
        text: '梳洗罢，独倚望江楼。过尽千帆皆不是，斜晖脉脉水悠悠。肠断白蘋洲。'
      }
    ],
    lines: [
      { p: '○◐●', r: false, rhythm: '3', note: '首句三字，一平二仄起调。' },
      { p: '◐●●○○', r: true, rhythm: '2,3', note: '五言句，韵脚落平。' },
      { p: '◐●◐○○●●', r: false, rhythm: '2,2,3', note: '七言，与下句宜对。' },
      { p: '◐○◐●●○○', r: true, rhythm: '2,2,3', note: '七言，承上句作对，韵脚。' },
      { p: '◐●●○○', r: true, rhythm: '2,3', note: '五言收束，韵脚。' }
    ]
  },
  {
    id: 'rumengling',
    name: '如梦令',
    alias: ['忆仙姿', '宴桃源', '比梅'],
    syllables: 33,
    sentenceCount: 7,
    styleTag: '婉约',
    rhymeType: '仄',
    rhymeGroups: [{ key: true, type: '仄' }],
    defaultBu: 'you_z',
    origin: '原名《忆仙姿》，后唐庄宗李存勖词有「如梦，如梦」，苏轼改为今名。单调小令。',
    description: '三十三字，七句五仄韵一叠韵。第五、六句为二字叠句，是全牌最吃紧处——须叠得巧，词意要有转折。',
    highlights: '叠句「知否，知否」并非重复，而是把情绪一顿再一推。',
    masterpieces: [
      {
        title: '如梦令·昨夜雨疏风骤',
        author: '李清照',
        text: '昨夜雨疏风骤，浓睡不消残酒。试问卷帘人，却道海棠依旧。知否，知否？应是绿肥红瘦。'
      },
      {
        title: '如梦令·常记溪亭日暮',
        author: '李清照',
        text: '常记溪亭日暮，沉醉不知归路。兴尽晚回舟，误入藕花深处。争渡，争渡，惊起一滩鸥鹭。'
      }
    ],
    lines: [
      { p: '●●◐○○●', r: true, rhythm: '2,2,2', note: '六言起句，仄韵。' },
      { p: '◐●●○○●', r: true, rhythm: '2,2,2', note: '六言，承句，韵脚。' },
      { p: '◐●●○○', r: false, rhythm: '2,3', note: '五言转，不押。' },
      { p: '●●●○○●', r: true, rhythm: '2,2,2', note: '六言，韵脚。' },
      { p: '○●', r: true, rhythm: '2', note: '二字句，叠句上半。' },
      { p: '○●', r: true, rhythm: '2', dup: true, note: '二字叠句，同字重复（与上一句完全相同）。' },
      { p: '◐●●○○●', r: true, rhythm: '2,2,2', note: '六言收，韵脚。' }
    ]
  },
  {
    id: 'xiangjianhuan',
    name: '相见欢',
    alias: ['乌夜啼', '秋夜月', '上西楼'],
    syllables: 36,
    sentenceCount: 7,
    styleTag: '沉郁',
    rhymeType: '平',
    rhymeGroups: [{ key: true, type: '平' }],
    defaultBu: 'you',
    origin: '唐教坊曲名。南唐后主李煜两首为此调绝唱，「自是人生长恨水长东」一出，遂成千古伤心之调。',
    description: '三十六字，上片三句三平韵，下片四句两平韵。上片两个九字长句（三、六停顿）宜一气呵成；下片三个三字句短促顿挫，末句九字一泻而下。',
    highlights: '三字短句连落，是情绪的顿点；末句九字，是那句说不出口的话。',
    masterpieces: [
      {
        title: '相见欢·无言独上西楼',
        author: '李煜',
        text: '无言独上西楼，月如钩。寂寞梧桐深院锁清秋。　剪不断，理还乱，是离愁。别是一般滋味在心头。'
      },
      {
        title: '相见欢·林花谢了春红',
        author: '李煜',
        text: '林花谢了春红，太匆匆。无奈朝来寒雨晚来风。　胭脂泪，相留醉，几时重。自是人生长恨水长东。'
      }
    ],
    lines: [
      { p: '◐○◐●○○', r: true, rhythm: '2,2,2', note: '六言，韵脚。' },
      { p: '●○○', r: true, rhythm: '3', note: '三字短句，韵脚。' },
      { p: '◐●◐○○●●○○', r: true, rhythm: '3,3,3', note: '九字长句，三顿，韵脚。' },
      { p: '●◐●', r: false, rhythm: '3', note: '三字顿句，不押。' },
      { p: '●◐●', r: false, rhythm: '3', note: '三字顿句，不押。' },
      { p: '●○○', r: true, rhythm: '3', note: '三字短句，韵脚。' },
      { p: '◐●◐○○●●○○', r: true, rhythm: '3,3,3', note: '九字长句收，韵脚。' }
    ]
  },
  {
    id: 'dianjiangchun',
    name: '点绛唇',
    alias: ['点樱桃', '十八香', '南浦月'],
    syllables: 41,
    sentenceCount: 9,
    styleTag: '婉约',
    rhymeType: '仄',
    rhymeGroups: [{ key: true, type: '仄' }],
    defaultBu: 'you_z',
    origin: '调名取江淹《咏美人春游》「白雪凝琼貌，明珠点绛唇」句。宋人多用以写闺情与闲愁。',
    description: '四十一字，上片四句三仄韵，下片五句四仄韵。四言、五言、七言错落，下片「和羞走」三字句是最灵巧的转折。',
    highlights: '「和羞走，倚门回首，却把青梅嗅」——三字句一转，少女情态全出。',
    masterpieces: [
      {
        title: '点绛唇·蹴罢秋千',
        author: '李清照',
        text: '蹴罢秋千，起来慵整纤纤手。露浓花瘦，薄汗轻衣透。　见客入来，袜刬金钗溜。和羞走，倚门回首，却把青梅嗅。'
      },
      {
        title: '点绛唇·新月娟娟',
        author: '汪藻',
        text: '新月娟娟，夜寒江静山衔斗。起来搔首，梅影横窗瘦。　好个霜天，闲却传杯手。君知否，乱鸦啼后，归兴浓于酒。'
      }
    ],
    lines: [
      { p: '◐●○○', r: false, rhythm: '2,2', note: '四言起，不押。' },
      { p: '◐○◐●○○●', r: true, rhythm: '2,2,3', note: '七言，韵脚。' },
      { p: '◐○◐●', r: true, rhythm: '2,2', note: '四言，韵脚。' },
      { p: '◐●○○●', r: true, rhythm: '2,3', note: '五言，韵脚。' },
      { p: '◐●●○', r: false, rhythm: '2,2', note: '四言，不押。' },
      { p: '◐●○○●', r: true, rhythm: '2,3', note: '五言，韵脚。' },
      { p: '○○●', r: true, rhythm: '3', note: '三字句，韵脚，全牌的活眼。' },
      { p: '◐○○●', r: true, rhythm: '2,2', note: '四言，韵脚。' },
      { p: '◐●○○●', r: true, rhythm: '2,3', note: '五言收，韵脚。' }
    ]
  },
  {
    id: 'huanxisha',
    name: '浣溪沙',
    alias: ['浣纱溪', '小庭花', '满院春'],
    syllables: 42,
    sentenceCount: 6,
    styleTag: '婉约',
    rhymeType: '平',
    rhymeGroups: [{ key: true, type: '平' }],
    defaultBu: 'hui',
    origin: '唐教坊曲名，因春秋时西施浣纱于若耶溪而得名。宋人词作数量最多的小令之一。',
    description: '四十二字，六句七言。上片三句三平韵，下片三句两平韵（下片首句不押）。全篇皆七言，过片两句宜对仗，是七律的「松弛版」。',
    highlights: '「无可奈何花落去，似曾相识燕归来」——过片对仗，是全词的呼吸口。',
    masterpieces: [
      {
        title: '浣溪沙·一曲新词酒一杯',
        author: '晏殊',
        text: '一曲新词酒一杯，去年天气旧亭台。夕阳西下几时回。　无可奈何花落去，似曾相识燕归来。小园香径独徘徊。'
      },
      {
        title: '浣溪沙·簌簌衣巾落枣花',
        author: '苏轼',
        text: '簌簌衣巾落枣花，村南村北响缫车。牛衣古柳卖黄瓜。　酒困路长惟欲睡，日高人渴漫思茶。敲门试问野人家。'
      }
    ],
    lines: [
      { p: '◐●◐○◐●○', r: true, rhythm: '2,2,3', note: '七言起句，韵脚。' },
      { p: '◐○◐●●○○', r: true, rhythm: '2,2,3', note: '七言，韵脚。' },
      { p: '◐○◐●●○○', r: true, rhythm: '2,2,3', note: '七言，韵脚。上片结。' },
      { p: '◐●◐○○●●', r: false, rhythm: '2,2,3', note: '过片七言，仄收不押。' },
      { p: '◐○◐●●○○', r: true, rhythm: '2,2,3', note: '七言，韵脚。' },
      { p: '◐○◐●●○○', r: true, rhythm: '2,2,3', note: '七言收，韵脚。' }
    ]
  },
  {
    id: 'pusaman',
    name: '菩萨蛮',
    alias: ['子夜歌', '重叠金', '花间意'],
    syllables: 44,
    sentenceCount: 8,
    styleTag: '婉约',
    rhymeType: '换',
    rhymeGroups: [
      { key: 'A', type: '仄' },
      { key: 'B', type: '平' },
      { key: 'C', type: '仄' },
      { key: 'D', type: '平' }
    ],
    defaultBu: 'jen',
    origin: '唐教坊曲名。唐时已有此调，温庭筠十四首为词体之始，李白《平林漠漠烟如织》一首被誉为「百代词曲之祖」。',
    description: '四十四字，上下片各四句，两仄韵转两平韵。全牌四换韵脚：仄—平—仄—平，声情由促转舒、再促再舒，最见顿挫之美。',
    highlights: '四换韵是这只曲子的呼吸——每两句换一口气，情绪一层层推上去。',
    masterpieces: [
      {
        title: '菩萨蛮·平林漠漠烟如织',
        author: '李白（一说无名氏）',
        text: '平林漠漠烟如织，寒山一带伤心碧。暝色入高楼，有人楼上愁。　玉阶空伫立，宿鸟归飞急。何处是归程，长亭连短亭。'
      },
      {
        title: '菩萨蛮·书江西造口壁',
        author: '辛弃疾',
        text: '郁孤台下清江水，中间多少行人泪。西北望长安，可怜无数山。　青山遮不住，毕竟东流去。江晚正愁余，山深闻鹧鸪。'
      }
    ],
    lines: [
      { p: '◐○◐●○○●', r: 'A', rhythm: '2,2,3', note: '七言，仄韵 A。' },
      { p: '◐○◐●○○●', r: 'A', rhythm: '2,2,3', note: '七言，仄韵 A。换韵处。' },
      { p: '◐●●○○', r: 'B', rhythm: '2,3', note: '五言，转平韵 B。' },
      { p: '◐○○●○', r: 'B', rhythm: '2,3', note: '五言，平韵 B。上片结。' },
      { p: '◐○○●●', r: 'C', rhythm: '2,3', note: '五言，转仄韵 C。' },
      { p: '◐●○○●', r: 'C', rhythm: '2,3', note: '五言，仄韵 C。' },
      { p: '◐●●○○', r: 'D', rhythm: '2,3', note: '五言，转平韵 D。' },
      { p: '◐○○●○', r: 'D', rhythm: '2,3', note: '五言收，平韵 D。' }
    ]
  },
  {
    id: 'zhegutian',
    name: '鹧鸪天',
    alias: ['思佳客', '思越人', '剪朝霞'],
    syllables: 55,
    sentenceCount: 9,
    styleTag: '清丽',
    rhymeType: '平',
    rhymeGroups: [{ key: true, type: '平' }],
    defaultBu: 'dong',
    origin: '词调取自郑嵎诗「春游鸡鹿塞，家在鹧鸪天」。由七律改製而成，只把第五句改为两个三字句。',
    description: '五十五字，上片四句三平韵，下片五句三平韵。形制最接近七律——上片四句全为七言，下片以两个三字句换气。宜写节令、怀人、酬赠。',
    highlights: '两个三字句「从别后，忆相逢」，是把七律掰开的那道缝。',
    masterpieces: [
      {
        title: '鹧鸪天·彩袖殷勤捧玉钟',
        author: '晏几道',
        text: '彩袖殷勤捧玉钟，当年拼却醉颜红。舞低杨柳楼心月，歌尽桃花扇底风。　从别后，忆相逢，几回魂梦与君同。今宵剩把银釭照，犹恐相逢是梦中。'
      },
      {
        title: '鹧鸪天·陌上柔桑破嫩芽',
        author: '辛弃疾',
        text: '陌上柔桑破嫩芽，东邻蚕种已生些。平冈细草鸣黄犊，斜日寒林点暮鸦。　山远近，路横斜，青旗沽酒有人家。城中桃李愁风雨，春在溪头荠菜花。'
      }
    ],
    lines: [
      { p: '◐●○○◐●○', r: true, rhythm: '2,2,3', note: '七言起，韵脚。' },
      { p: '◐○◐●●○○', r: true, rhythm: '2,2,3', note: '七言，韵脚。' },
      { p: '◐○◐●○○●', r: false, rhythm: '2,2,3', note: '七言，仄收不押。宜与下句对。' },
      { p: '◐●○○●●○', r: true, rhythm: '2,2,3', note: '七言，韵脚。上片结。' },
      { p: '◐◐●', r: false, rhythm: '3', note: '三字句，不押。' },
      { p: '●○○', r: true, rhythm: '3', note: '三字句，韵脚。' },
      { p: '◐○◐●●○○', r: true, rhythm: '2,2,3', note: '七言，韵脚。' },
      { p: '◐○◐●○○●', r: false, rhythm: '2,2,3', note: '七言，仄收不押。' },
      { p: '◐●○○●●○', r: true, rhythm: '2,2,3', note: '七言收，韵脚。' }
    ]
  },
  {
    id: 'yumeiren',
    name: '虞美人',
    alias: ['一江春水', '玉壶冰', '虞美人令'],
    syllables: 56,
    sentenceCount: 8,
    styleTag: '沉郁',
    rhymeType: '换',
    rhymeGroups: [
      { key: 'A', type: '仄' },
      { key: 'B', type: '平' },
      { key: 'C', type: '仄' },
      { key: 'D', type: '平' }
    ],
    defaultBu: 'jen',
    origin: '唐教坊曲名，本咏项羽宠姬虞姬。南唐后主李煜一首「春花秋月何时了」为此调千古绝唱。',
    description: '五十六字，上下片各四句，两仄韵转两平韵。句式为七、五、七、九，长句在末——全牌的力量都攒在那句九言上。',
    highlights: '「恰似一江春水向东流」——九字长句不换气，一发到底。',
    masterpieces: [
      {
        title: '虞美人·春花秋月何时了',
        author: '李煜',
        text: '春花秋月何时了，往事知多少。小楼昨夜又东风，故国不堪回首月明中。　雕栏玉砌应犹在，只是朱颜改。问君能有几多愁，恰似一江春水向东流。'
      },
      {
        title: '虞美人·听雨',
        author: '蒋捷',
        text: '少年听雨歌楼上，红烛昏罗帐。壮年听雨客舟中，江阔云低断雁叫西风。　而今听雨僧庐下，鬓已星星也。悲欢离合总无情，一任阶前点滴到天明。'
      }
    ],
    lines: [
      { p: '◐○◐●○○●', r: 'A', rhythm: '2,2,3', note: '七言，仄韵 A。' },
      { p: '◐●○○●', r: 'A', rhythm: '2,3', note: '五言，仄韵 A。换韵处。' },
      { p: '◐○◐●●○○', r: 'B', rhythm: '2,2,3', note: '七言，转平韵 B。' },
      { p: '◐●◐○◐●◐○○', r: 'B', rhythm: '2,2,2,3', note: '九言长句，平韵 B。上片结。' },
      { p: '◐○◐●○○●', r: 'C', rhythm: '2,2,3', note: '七言，转仄韵 C。' },
      { p: '◐●○○●', r: 'C', rhythm: '2,3', note: '五言，仄韵 C。' },
      { p: '◐○◐●●○○', r: 'D', rhythm: '2,2,3', note: '七言，转平韵 D。' },
      { p: '◐●◐○◐●◐○○', r: 'D', rhythm: '2,2,2,3', note: '九言长句收，平韵 D。' }
    ]
  },
  {
    id: 'dielianhua',
    name: '蝶恋花',
    alias: ['鹊踏枝', '凤栖梧', '黄金缕'],
    syllables: 60,
    sentenceCount: 10,
    styleTag: '婉约',
    rhymeType: '仄',
    rhymeGroups: [{ key: true, type: '仄' }],
    defaultBu: 'shao_z',
    origin: '本名《鹊踏枝》，唐教坊曲。晏殊改为今名，取梁简文帝「翻阶蛱蝶恋花情」句。',
    description: '六十字，上下片各五句四仄韵。句式七、四、五、七、七，四言句夹在七言之间，如呼吸中的一次短促停顿，最宜写缠绵往复之情。',
    highlights: '「枝上柳绵吹又少，天涯何处无芳草」——七言结句一扬，前面积蓄的沉郁全被带走。',
    masterpieces: [
      {
        title: '蝶恋花·春景',
        author: '苏轼',
        text: '花褪残红青杏小，燕子飞时，绿水人家绕。枝上柳绵吹又少，天涯何处无芳草。　墙里秋千墙外道，墙外行人，墙里佳人笑。笑渐不闻声渐悄，多情却被无情恼。'
      },
      {
        title: '蝶恋花·伫倚危楼风细细',
        author: '柳永',
        text: '伫倚危楼风细细，望极春愁，黯黯生天际。草色烟光残照里，无言谁会凭阑意。　拟把疏狂图一醉，对酒当歌，强乐还无味。衣带渐宽终不悔，为伊消得人憔悴。'
      }
    ],
    lines: [
      { p: '◐●◐○○●●', r: true, rhythm: '2,2,3', note: '七言，仄韵。' },
      { p: '◐●○○', r: false, rhythm: '2,2', note: '四言，不押。' },
      { p: '◐●○○●', r: true, rhythm: '2,3', note: '五言，韵脚。上片小结。' },
      { p: '◐●◐○○●●', r: true, rhythm: '2,2,3', note: '七言，韵脚。' },
      { p: '◐○◐●○○●', r: true, rhythm: '2,2,3', note: '七言结，韵脚。' },
      { p: '◐●◐○○●●', r: true, rhythm: '2,2,3', note: '下片起，七言，韵脚。' },
      { p: '◐●○○', r: false, rhythm: '2,2', note: '四言，不押。' },
      { p: '◐●○○●', r: true, rhythm: '2,3', note: '五言，韵脚。' },
      { p: '◐●◐○○●●', r: true, rhythm: '2,2,3', note: '七言，韵脚。' },
      { p: '◐○◐●○○●', r: true, rhythm: '2,2,3', note: '七言收，韵脚。' }
    ]
  },
  {
    id: 'shuidiaogetou',
    name: '水调歌头',
    alias: ['元会曲', '凯歌', '台城游'],
    syllables: 95,
    sentenceCount: 19,
    styleTag: '豪放',
    rhymeType: '平',
    rhymeGroups: [{ key: true, type: '平' }],
    defaultBu: 'shan',
    origin: '唐大曲《水调》之歌头，取全曲首章而得名。长调中声情最开阔者，「明月几时有」一出遂成中秋绝唱。',
    description: '九十五字，上片九句四平韵，下片十句四平韵。五言、六言交替推进，下片起处三个三字句是全牌转关，末两句五言须收得住、放得远。',
    highlights: '九十五字不是难点，难在下片「转朱阁，低绮户，照无眠」三句短促之后，仍能接住七言的舒展。',
    masterpieces: [
      {
        title: '水调歌头·明月几时有',
        author: '苏轼',
        text: '明月几时有，把酒问青天。不知天上宫阙，今夕是何年。我欲乘风归去，又恐琼楼玉宇，高处不胜寒。起舞弄清影，何似在人间。　转朱阁，低绮户，照无眠。不应有恨，何事长向别时圆。人有悲欢离合，月有阴晴圆缺，此事古难全。但愿人长久，千里共婵娟。'
      },
      {
        title: '水调歌头·送章德茂大卿使虏',
        author: '陈亮',
        text: '不见南师久，漫说北群空。当场只手，毕竟还我万夫雄。自笑堂堂汉使，得似洋洋河水，依旧只流东。且复穹庐拜，会向藁街逢。　尧之都，舜之壤，禹之封，于中应有，一个半个耻臣戎。万里腥膻如许，千古英灵安在，磅礴几时通。胡运何须问，赫日自当中。'
      }
    ],
    lines: [
      { p: '◐●●○●', r: false, rhythm: '2,3', note: '五言起，仄收。' },
      { p: '◐●●○○', r: true, rhythm: '2,3', note: '五言，韵脚。' },
      { p: '◐○◐●○●', r: false, rhythm: '2,2,2', note: '六言，仄收。' },
      { p: '◐●●○○', r: true, rhythm: '2,3', note: '五言，韵脚。' },
      { p: '◐●◐○◐●', r: false, rhythm: '2,2,2', note: '六言，与下句句式同。' },
      { p: '◐●◐○◐●', r: false, rhythm: '2,2,2', note: '六言，承上句。' },
      { p: '◐●●○○', r: true, rhythm: '2,3', note: '五言，韵脚。上片小结。' },
      { p: '◐●●○●', r: false, rhythm: '2,3', note: '五言，仄收。' },
      { p: '◐●●○○', r: true, rhythm: '2,3', note: '五言收上片，韵脚。' },
      { p: '●◐●', r: false, rhythm: '3', note: '下片起，三字句。' },
      { p: '○●●', r: false, rhythm: '3', note: '三字句。' },
      { p: '●○○', r: true, rhythm: '3', note: '三字句，韵脚。' },
      { p: '◐○◐●', r: false, rhythm: '2,2', note: '四言，不押。' },
      { p: '◐●◐○◐●○', r: true, rhythm: '2,2,3', note: '七言，韵脚。' },
      { p: '◐●◐○◐●', r: false, rhythm: '2,2,2', note: '六言。' },
      { p: '◐●◐○◐●', r: false, rhythm: '2,2,2', note: '六言。' },
      { p: '◐●●○○', r: true, rhythm: '2,3', note: '五言，韵脚。' },
      { p: '◐●●○●', r: false, rhythm: '2,3', note: '五言，仄收。' },
      { p: '◐●●○○', r: true, rhythm: '2,3', note: '五言收全篇，韵脚。' }
    ]
  }
]

/**
 * 仅作词条收录（格律谱因版本差异较大，暂不参与自动填词，
 * 界面上会明确标注「谱待补」，可查看简介与代表作）。
 */
export const CIPAI_CATALOG_ONLY = [
  {
    id: 'manjianghong',
    name: '满江红',
    alias: ['上江虹', '念良游', '伤春曲'],
    syllables: 93,
    sentenceCount: 18,
    styleTag: '豪放',
    rhymeType: '仄',
    origin: '唐教坊曲名，后用作词调。宋人以仄韵体为主，声情激越，靖康之后多以此调抒家国之痛。',
    description: '九十三字，长调。上片八句四仄韵，下片十句五仄韵。全篇以四言、七言为主，间以三字顿句，气象雄阔，是豪放词最常用的长调之一。',
    highlights: '「三十功名尘与土，八千里路云和月」——七言对仗压住整片江山的重量。',
    masterpieces: [
      {
        title: '满江红·怒发冲冠',
        author: '岳飞',
        text: '怒发冲冠，凭栏处、潇潇雨歇。抬望眼、仰天长啸，壮怀激烈。三十功名尘与土，八千里路云和月。莫等闲、白了少年头，空悲切。\n靖康耻，犹未雪。臣子恨，何时灭。驾长车，踏破贺兰山缺。壮志饥餐胡虏肉，笑谈渴饮匈奴血。待从头、收拾旧山河，朝天阙。'
      }
    ],
    lines: [],
    note: '本调句读与平仄在诸家词谱中差异较大（「凭栏处」等处断句不一），为避免给出不准确的谱，本表只收录词条与代表作，暂不参与自动填词。'
  },
  {
    id: 'linjiangxian',
    name: '临江仙',
    alias: ['庭院深深', '雁后归', '画屏春'],
    syllables: 60,
    sentenceCount: 10,
    styleTag: '疏朗',
    rhymeType: '平',
    origin: '唐教坊曲名，本咏水仙，后用为词调。宋人以此调名作极多。',
    description: '六十字，双调，上下片各五句三平韵。句式七、六、七、五、五，声情疏缓，宜写怀古、感旧、赠别。',
    highlights: '「滚滚长江东逝水，浪花淘尽英雄」——起句七言一拍，六言一收，气象顿开。',
    masterpieces: [
      {
        title: '临江仙·滚滚长江东逝水',
        author: '杨慎',
        text: '滚滚长江东逝水，浪花淘尽英雄。是非成败转头空。青山依旧在，几度夕阳红。\n白发渔樵江渚上，惯看秋月春风。一壶浊酒喜相逢。古今多少事，都付笑谈中。'
      }
    ],
    lines: [],
    note: '本调有 58 字、60 字等多种体式，且上下片句式版本不一，故只收录词条与代表作。'
  }
]

export const ALL_CIPAI = [...CIPAI, ...CIPAI_CATALOG_ONLY]

export function getCipai(id) {
  return ALL_CIPAI.find((c) => c.id === id) || null
}

/** 该词牌是否支持自动填词 */
export function isGeneratable(c) {
  return !!(c && c.lines && c.lines.length > 0)
}

/** 词牌的全部韵脚分组 */
export function rhymeGroupsOf(c) {
  return c.rhymeGroups && c.rhymeGroups.length ? c.rhymeGroups : [{ key: true, type: '平' }]
}

/** 计算某一句的平仄统计（用于界面展示） */
export function lineStats(pattern) {
  let ping = 0
  let ze = 0
  let both = 0
  for (const ch of pattern) {
    if (ch === '○') ping++
    else if (ch === '●') ze++
    else if (ch === '◐') both++
  }
  return { ping, ze, both, total: pattern.length }
}

/** 字的平仄符号（用于展示） */
export const TONE_SYMBOL = { ping: '○', ze: '●', both: '◐' }
