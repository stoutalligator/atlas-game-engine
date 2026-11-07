import type { ColorPicture } from "../library.js";
import * as C from "./colors.js";

// Tuesday: 7×7. "." = empty; letters are palette keys. Every picture must be
// solvable by line logic alone (the tests check).

export const SIZE_7: ColorPicture[] = [
  {
    name: "Ice cream cone",
    palette: { P: C.PINK, W: C.BLUSH, C: C.AMBER, D: C.BROWN },
    rows: ["..PPP..", ".PPWPP.", "PPPPPPP", ".CDCDC.", "..CDC..", "..DCD..", "...C..."],
  },
  {
    name: "Pair of cherries",
    palette: { G: C.GREEN, S: C.OLIVE, R: C.RED, H: C.ROSE },
    rows: ["...GG..", "...S...", "..S.S..", ".S...S.", "RRR.RRR", "RHR.RHR", ".R...R."],
  },
  {
    name: "Rubber duck",
    palette: { Y: C.YELLOW, O: C.ORANGE, K: C.BLACK },
    rows: ["..YYY..", ".YYKYOO", ".YYYY..", "YYYYYYY", "YYYYYYY", ".YYYYY.", "......."],
  },
  {
    name: "Cat",
    palette: { K: C.BLACK, G: C.LIME, P: C.PINK },
    rows: [".K...K.", "KKK.KKK", "KKKKKKK", "KGKKKGK", "KKKPKKK", "KKKKKKK", ".KKKKK."],
  },
  {
    name: "Pig",
    palette: { P: C.PINK, D: C.MAGENTA, K: C.BLACK },
    rows: ["PP...PP", "PPPPPPP", "PKPPPKP", "PPDDDPP", "PDKDKDP", ".PDDDP.", "..PPP.."],
  },
  {
    name: "Frog",
    palette: { C: C.SAND, K: C.BLACK, G: C.GREEN, R: C.RED },
    rows: [".CC.CC.", "CKCGCKC", "GGGGGGG", "GRRRRRG", "GGGGGGG", ".GGGGG.", "GG...GG"],
  },
  {
    name: "Penguin",
    palette: { K: C.BLACK, S: C.SNOW, O: C.ORANGE },
    rows: ["..KKK..", ".KSKSK.", ".KKOKK.", "KKSSSKK", "KKSSSKK", ".KSSSK.", ".OO.OO."],
  },
  {
    name: "Fox",
    palette: { O: C.ORANGE, S: C.SNOW, K: C.BLACK },
    rows: ["OO...OO", "OOO.OOO", "OOOOOOO", "OKOOOKO", "SSOOOSS", ".SSKSS.", "..SSS.."],
  },
  {
    name: "Hatching chick",
    palette: { Y: C.YELLOW, K: C.BLACK, O: C.ORANGE, S: C.SAND },
    rows: ["..YYY..", ".YKYKY.", ".YYOYY.", "S.YYY.S", "SS.S.SS", "SSSSSSS", ".SSSSS."],
  },
  {
    name: "Snail",
    palette: { S: C.AMBER, L: C.SAND, K: C.BLACK, B: C.OLIVE },
    rows: ["...SSS.", "..SLLLS", "..SLSLS", "K.SLLSS", "B..SSS.", "BBBBBBB", "......."],
  },
  {
    name: "Turtle",
    palette: { D: C.DARK_GREEN, G: C.OLIVE, L: C.LIME },
    rows: ["......", ".DDDD..", ".DGDGD.", "DGDGDGL", "DDDDDDL", ".LL.LL.", "......."].map((r) =>
      r.padEnd(7, "."),
    ),
  },
  {
    name: "Whale",
    palette: { S: C.SKY, B: C.BLUE, K: C.BLACK },
    rows: ["...S...", "..S.S..", "..BBB.B", ".BBBBBB", "BKBBBB.", "BBBBBB.", "......."],
  },
  {
    name: "Octopus",
    palette: { P: C.PURPLE, K: C.BLACK },
    rows: ["..PPP..", ".PPPPP.", ".PKPKP.", ".PPPPP.", "PP.P.PP", "P.P.P.P", "......."],
  },
  {
    name: "Crab",
    palette: { R: C.RED, K: C.BLACK },
    rows: ["RR...RR", "R.K.K.R", ".RRRRR.", "RRRRRRR", ".RRRRR.", "R.R.R.R", "......."],
  },
  {
    name: "Jellyfish",
    palette: { P: C.MAGENTA, L: C.PINK },
    rows: ["......", "..PPP..", ".PPPPP.", "PPPPPPP", "L.L.L.L", ".L.L.L.", "L.L.L.L"].map((r) =>
      r.padEnd(7, "."),
    ),
  },
  {
    name: "Bee",
    palette: { S: C.ICE, Y: C.YELLOW, K: C.BLACK },
    rows: ["..SS...", ".SSSS..", "YKYKYK.", "YKYKYKK", "YKYKYK.", "......", "......."].map((r) =>
      r.padEnd(7, "."),
    ),
  },
  {
    name: "Strawberry",
    palette: { G: C.GREEN, R: C.RED, Y: C.YELLOW },
    rows: [".G.G.G.", "..GGG..", ".RRRRR.", "RRYRRYR", ".RYRYR.", "..RRR..", "...R..."],
  },
  {
    name: "Pineapple",
    palette: { G: C.GREEN, Y: C.YELLOW, O: C.AMBER },
    rows: [".G.G.G.", "..GGG..", ".YOYOY.", ".OYOYO.", ".YOYOY.", ".OYOYO.", "..YOY.."],
  },
  {
    name: "Bunch of grapes",
    palette: { G: C.GREEN, P: C.PURPLE },
    rows: ["....G..", "...G...", ".PPPPP.", "PPPPPPP", ".PPPPP.", "..PPP..", "...P..."],
  },
  {
    name: "Pear",
    palette: { B: C.BROWN, L: C.LIME },
    rows: ["...B...", "...L...", "..LLL..", "..LLL..", ".LLLLL.", "LLLLLLL", ".LLLLL."],
  },
  {
    name: "Cupcake",
    palette: { R: C.RED, P: C.PINK, T: C.AMBER, B: C.BROWN },
    rows: ["...R...", "..PPP..", ".PPPPP.", "PPPPPPP", ".TBTBT.", ".TBTBT.", "..TTT.."],
  },
  {
    name: "Donut",
    palette: { P: C.PINK, Y: C.YELLOW, R: C.SKY, T: C.AMBER },
    rows: ["......", "..PPP..", ".PYPRP.", ".PP.PP.", ".TPPPT.", "..TTT..", "......."].map((r) =>
      r.padEnd(7, "."),
    ),
  },
  {
    name: "Pizza slice",
    palette: { T: C.AMBER, Y: C.YELLOW, R: C.RED },
    rows: ["TTTTTTT", ".YRYYY.", ".YYYRY.", "..YRY..", "..YYY..", "...Y...", "......."],
  },
  {
    name: "Burger",
    palette: { T: C.AMBER, G: C.GRASS, Y: C.YELLOW, B: C.CHOCOLATE },
    rows: ["..TTT..", ".TTTTT.", "GGGGGGG", "YYYYYYY", ".BBBBB.", ".TTTTT.", "......."],
  },
  {
    name: "Teacup",
    palette: { S: C.GREY, C: C.TEAL },
    rows: ["..S.S..", ".S.S...", "CCCCCC.", "CCCCC.C", "CCCCCC.", ".CCCC..", "SSSSSSS"],
  },
  {
    name: "Rainbow",
    palette: { R: C.RED, O: C.ORANGE, Y: C.YELLOW },
    rows: ["......", "..RRR..", ".ROOOR.", "ROYYYOR", "ROY.YOR", "ROY.YOR", "......."].map((r) =>
      r.padEnd(7, "."),
    ),
  },
  {
    name: "Rain cloud",
    palette: { S: C.GREY, B: C.BLUE },
    rows: ["..SS...", ".SSSSS.", "SSSSSSS", ".SSSSS.", "......", ".B.B.B.", ".B.B.B."].map((r) =>
      r.padEnd(7, "."),
    ),
  },
  {
    name: "Palm tree",
    palette: { G: C.GREEN, B: C.BROWN, Y: C.SAND },
    rows: [".GG.GG.", "GGGBGGG", "G..B..G", "...B...", "..B....", "..B....", "YYYYYYY"],
  },
  {
    name: "Potted flower",
    palette: { R: C.RED, Y: C.YELLOW, G: C.GREEN, O: C.CORAL },
    rows: ["..RRR..", ".RRYRR.", "..RRR..", "...G...", ".G.G...", ".OOOOO.", "..OOO.."],
  },
  {
    name: "Lighthouse",
    palette: { R: C.RED, Y: C.YELLOW, S: C.SNOW, B: C.BLUE },
    rows: ["...R...", "..YYY..", "..RRR..", "..SSS..", "..RRR..", ".SSSSS.", "BBBBBBB"],
  },
  {
    name: "Castle",
    palette: { R: C.RED, S: C.GREY, K: C.SLATE, B: C.BROWN },
    rows: ["...R...", "S.S.S.S", "SSSSSSS", "SKSSSKS", "SSSSSSS", "SSBBBSS", "SSBBBSS"],
  },
  {
    name: "Padlock",
    palette: { S: C.STEEL, Y: C.GOLD, K: C.BLACK },
    rows: ["..SSS..", ".S...S.", ".S...S.", "YYYYYYY", "YYYKYYY", "YYYKYYY", "YYYYYYY"],
  },
  {
    name: "Light bulb",
    palette: { Y: C.YELLOW, S: C.GREY },
    rows: ["..YYY..", ".YYYYY.", "YYYYYYY", "YYYYYYY", ".YYYYY.", "..SSS..", "...S..."],
  },
  {
    name: "Magnifying glass",
    palette: { S: C.SLATE, C: C.ICE, B: C.BROWN },
    rows: [".SSS...", "SCCCS..", "SCCCS..", "SCCCS..", ".SSSB..", "....BB.", ".....BB"],
  },
  {
    name: "Camera",
    palette: { K: C.CHARCOAL, S: C.GREY, C: C.SKY },
    rows: ["......", ".KK....", "KKKKKKK", "KKSSSKK", "KKSCSKK", "KKSSSKK", "KKKKKKK"].map((r) =>
      r.padEnd(7, "."),
    ),
  },
  {
    name: "Television",
    palette: { K: C.BLACK, B: C.BROWN, C: C.SKY },
    rows: [".K...K.", "..K.K..", "BBBBBBB", "BCCCCBB", "BCCCCBK", "BCCCCBB", "BBBBBBB"],
  },
  {
    name: "Game controller",
    palette: { S: C.GREY, K: C.CHARCOAL, R: C.RED, B: C.BLUE },
    rows: ["......", ".SSSSS.", "SSKSSRS", "SKKKSSB", "SSKSSSS", "SS...SS", "......."].map((r) =>
      r.padEnd(7, "."),
    ),
  },
  {
    name: "Die",
    palette: { S: C.SNOW },
    rows: ["SSSSSSS", "S.SSS.S", "SSSSSSS", "SSS.SSS", "SSSSSSS", "S.SSS.S", "SSSSSSS"],
  },
  {
    name: "Rook",
    palette: { K: C.CHARCOAL },
    rows: [".K.K.K.", ".KKKKK.", "..KKK..", "..KKK..", "..KKK..", ".KKKKK.", "KKKKKKK"],
  },
  {
    name: "Medal",
    palette: { R: C.RED, B: C.BLUE, Y: C.GOLD, O: C.AMBER },
    rows: ["..RBR..", "..RBR..", "..RBR..", "..YYY..", ".YYOYY.", ".YOOOY.", "..YYY.."],
  },
  {
    name: "Flying saucer",
    palette: { C: C.ICE, S: C.GREY, Y: C.YELLOW },
    rows: ["..CCC..", ".CCCCC.", "SSSSSSS", "SYSYSYS", ".SSSSS.", "..Y.Y..", ".Y...Y."],
  },
  {
    name: "Saturn",
    palette: { O: C.ORANGE, Y: C.SAND },
    rows: ["......", "..OOO..", "YOOOOOY", ".YYYYY.", "..OOO..", "......", "......."].map((r) =>
      r.padEnd(7, "."),
    ),
  },
  {
    name: "Steam train",
    palette: { S: C.GREY, K: C.CHARCOAL, R: C.RED, C: C.SKY },
    rows: ["S......", ".S..RRR", "KK..RCR", "RRRRRRR", "RRRRRRR", ".K.K.K.", "......."],
  },
  {
    name: "Kite",
    palette: { R: C.RED, B: C.BLUE, Y: C.YELLOW },
    rows: ["...R...", "..RRB..", ".RRRBB.", "RRRRBBB", ".RRBB..", "..RB...", "...Y..."],
  },
  {
    name: "Balloon",
    palette: { R: C.RED, K: C.SLATE },
    rows: ["..RRR..", ".RRRRR.", ".RRRRR.", "..RRR..", "...R...", "...K...", "..K...."],
  },
  {
    name: "Witch hat",
    palette: { P: C.PLUM, Y: C.YELLOW },
    rows: ["...P...", "...PP..", "..PPP..", "..PPP..", ".YYYYY.", "PPPPPPP", "......."],
  },
  {
    name: "Boot",
    palette: { B: C.BROWN },
    rows: [".BBB...", ".BBB...", ".BBB...", ".BBBB..", ".BBBBBB", ".BBBBBB", "......."],
  },
  {
    name: "Mitten",
    palette: { R: C.RED, S: C.SNOW },
    rows: [".RRR...", "RRRRR.R", "RRRRRRR", "RRRRRR.", "RRRRR..", "SSSSS..", "SSSSS.."],
  },
  {
    name: "Speech bubble",
    palette: { B: C.SEA },
    rows: ["BBBBBBB", "B.....B", "B.....B", "BBBBBBB", ".BB....", ".B.....", "......."],
  },
  {
    name: "Diamond ring",
    palette: { C: C.SKY, Y: C.GOLD },
    rows: ["..CCC..", ".CCCCC.", "..CCC..", "...C...", "..YYY..", ".Y...Y.", "..YYY.."],
  },
  {
    name: "Striped sock",
    palette: { S: C.WHITE_ISH, B: C.BLUE, R: C.RED },
    rows: ["...RRR.", "...BBB.", "...RRR.", "...BBB.", ".BBBBB.", "BBBBBB.", "BBBB..."],
  },
  {
    name: "Ladybird",
    palette: { K: C.BLACK, R: C.RED },
    rows: ["..KKK..", ".KKKKK.", "RRRKRRR", "RKRKRKR", "RRRKRRR", ".RKKKR.", "..RKR.."],
  },
];
