import type { ColorPicture } from "../library.js";
import {
  AMBER,
  BLACK,
  BLUE,
  BROWN,
  CREAM,
  DARK_GREEN,
  GREEN,
  GREY,
  LAVENDER,
  LIME,
  NAVY,
  ORANGE,
  PINK,
  PURPLE,
  RED,
  ROSE,
  SKY,
  SNOW,
  STEEL,
  TAN,
  TEAL,
  YELLOW,
} from "./colors.js";

// Monday: 5×5. "." = empty; letters are palette keys. Every picture must be
// solvable by line logic alone (the tests check).

export const SIZE_5: ColorPicture[] = [
  {
    name: "Heart",
    palette: { R: "#e11d48", P: ROSE },
    rows: [".R.R.", "RPRRR", "RRRRR", ".RRR.", "..R.."],
  },
  {
    name: "Pine tree",
    palette: { G: DARK_GREEN, L: GREEN, B: BROWN },
    rows: ["..G..", ".GLG.", "GGLGG", "..B..", ".BBB."],
  },
  {
    name: "Mushroom",
    palette: { R: RED, W: CREAM, S: TAN },
    rows: [".RRR.", "RWRWR", "RRRRR", ".SSS.", ".S.S."],
  },
  {
    name: "Sailboat",
    palette: { S: AMBER, M: BROWN, B: BLUE },
    rows: ["..S..", ".SS..", "SSS..", "..M..", "BBBBB"],
  },
  {
    name: "House",
    palette: { R: RED, T: TAN, D: BROWN },
    rows: ["..R..", ".RRR.", "RRRRR", ".TDT.", ".TDT."],
  },
  {
    name: "Smiley",
    palette: { Y: YELLOW, K: BLACK },
    rows: [".YYY.", "YKYKY", "YYYYY", "YKKKY", ".YYY."],
  },
  {
    name: "Trophy",
    palette: { Y: AMBER, B: BROWN },
    rows: ["YYYYY", "YYYYY", ".YYY.", "..Y..", ".BBB."],
  },
  {
    name: "Fish",
    palette: { O: ORANGE, K: BLACK },
    rows: [".....", ".OO.O", "OKOOO", ".OO.O", "....."],
  },
  {
    name: "Bell",
    palette: { Y: AMBER, O: ORANGE },
    rows: ["..Y..", ".YYY.", ".YYY.", "YYYYY", "..O.."],
  },
  {
    name: "Umbrella",
    palette: { R: RED, K: STEEL },
    rows: [".RRR.", "RRRRR", "..K..", "..K..", ".KK.."],
  },
  {
    name: "Crescent moon",
    palette: { Y: "#fde047" },
    rows: [".YYY.", "YY...", "Y....", "YY...", ".YYY."],
  },
  {
    name: "Sun",
    palette: { Y: YELLOW, O: ORANGE },
    rows: ["Y.Y.Y", ".OOO.", "YOOOY", ".OOO.", "Y.Y.Y"],
  },
  {
    name: "Apple",
    palette: { B: BROWN, G: GREEN, R: RED },
    rows: ["..BG.", ".RRR.", "RRRRR", "RRRRR", ".R.R."],
  },
  {
    name: "Lollipop",
    palette: { P: PINK, W: CREAM, K: TAN },
    rows: [".PPP.", "PPWPP", ".PPP.", "..K..", "..K.."],
  },
  {
    name: "Candle",
    palette: { O: ORANGE, Y: YELLOW, R: RED },
    rows: ["..O..", "..Y..", ".RRR.", ".RRR.", "RRRRR"],
  },
  {
    name: "Gem",
    palette: { C: SKY, B: BLUE },
    rows: [".....", ".CCC.", "CCBCC", ".CBC.", "..C.."],
  },
  {
    name: "Ghost",
    palette: { L: LAVENDER, K: BLACK },
    rows: [".LLL.", "LKLKL", "LLLLL", "LLLLL", "L.L.L"],
  },
  {
    name: "Robot",
    palette: { R: RED, S: GREY, K: SKY },
    rows: ["..R..", ".SSS.", "SKSKS", "SSSSS", ".S.S."],
  },
  {
    name: "Bunny",
    palette: { G: GREY, P: PINK, K: BLACK },
    rows: [".G.G.", ".P.P.", "GGGGG", "GKGKG", ".GGG."],
  },
  { name: "Envelope", palette: { B: SKY }, rows: ["BBBBB", "BB.BB", "B.B.B", "B...B", "BBBBB"] },
  {
    name: "Hourglass",
    palette: { T: BROWN, S: AMBER },
    rows: ["TTTTT", ".SSS.", "..S..", ".SSS.", "TTTTT"],
  },
  { name: "Star", palette: { Y: YELLOW }, rows: ["..Y..", "YYYYY", ".YYY.", ".Y.Y.", "Y...Y"] },
  {
    name: "Music note",
    palette: { K: PURPLE },
    rows: ["..KK.", "..K.K", "..K..", "KKK..", "KKK.."],
  },
  {
    name: "Crown",
    palette: { Y: AMBER, R: RED, B: BLUE },
    rows: ["Y.Y.Y", "YYYYY", "YRYBY", "YYYYY", "....."],
  },
  {
    name: "Tulip",
    palette: { R: RED, G: GREEN },
    rows: ["R.R.R", "RRRRR", ".RRR.", "..G..", "GGG.."],
  },
  {
    name: "Snowman",
    palette: { K: BLACK, S: SNOW },
    rows: [".KKK.", "..S..", ".SSS.", "SSSSS", ".SSS."],
  },
  { name: "T-shirt", palette: { B: BLUE }, rows: ["BB.BB", "BBBBB", ".BBB.", ".BBB.", ".BBB."] },
  {
    name: "Coffee mug",
    palette: { S: SNOW, M: TEAL },
    rows: [".S.S.", "MMMM.", "MMMMM", "MMMM.", ".MM.."],
  },
  {
    name: "Oak tree",
    palette: { G: GREEN, B: BROWN },
    rows: [".GGG.", "GGGGG", "GGGGG", "..B..", "..B.."],
  },
  {
    name: "Rocket",
    palette: { R: RED, S: SNOW, B: SKY, O: ORANGE },
    rows: ["..R..", ".SBS.", ".SSS.", "RSSSR", "R.O.R"],
  },
  {
    name: "Car",
    palette: { R: RED, K: BLACK },
    rows: [".....", ".RRR.", "RRRRR", "RRRRR", ".K.K."],
  },
  {
    name: "Top hat",
    palette: { K: BLACK, R: RED },
    rows: [".KKK.", ".KKK.", ".RRR.", "KKKKK", "....."],
  },
  {
    name: "Pair of glasses",
    palette: { K: BLACK, C: SKY },
    rows: [".....", "KKKKK", "KCKCK", "KK.KK", "....."],
  },
  { name: "Bow tie", palette: { R: RED }, rows: ["R...R", "RR.RR", "RRRRR", "RR.RR", "R...R"] },
  {
    name: "Butterfly",
    palette: { P: PURPLE, K: BLACK },
    rows: ["PP.PP", "PPKPP", "..K..", "PPKPP", "PP.PP"],
  },
  { name: "Anchor", palette: { N: NAVY }, rows: ["..N..", ".NNN.", "..N..", "N.N.N", ".NNN."] },
  {
    name: "Pumpkin",
    palette: { G: GREEN, O: ORANGE },
    rows: ["..G..", ".OOO.", "OOOOO", "OOOOO", ".OOO."],
  },
  {
    name: "Daisy",
    palette: { P: PINK, Y: YELLOW, G: GREEN },
    rows: [".PPP.", "PPYPP", ".PPP.", "..G..", ".GG.."],
  },
  {
    name: "Shield",
    palette: { S: STEEL, B: BLUE },
    rows: ["SSSSS", "SBBBS", "SBBBS", ".SBS.", "..S.."],
  },
  {
    name: "Ice cream",
    palette: { P: PINK, T: AMBER },
    rows: [".PPP.", "PPPPP", ".TTT.", ".TTT.", "..T.."],
  },
  {
    name: "Watermelon",
    palette: { R: RED, K: BLACK, G: GREEN },
    rows: [".....", "RRKRR", "GRRRG", ".GGG.", "....."],
  },
  {
    name: "Duck",
    palette: { Y: YELLOW, K: BLACK, O: ORANGE },
    rows: [".YY..", ".YKOO", ".YY..", "YYYYY", ".YYY."],
  },
  {
    name: "Ladybug",
    palette: { K: BLACK, R: RED },
    rows: ["K...K", ".KKK.", "RRKRR", "RKRKR", ".RKR."],
  },
  {
    name: "Gift",
    palette: { R: RED, G: GREEN },
    rows: ["RR.RR", "..R..", "GGRGG", "GGRGG", "GGRGG"],
  },
  { name: "Key", palette: { Y: AMBER }, rows: ["YYY..", "Y.Y..", "YYYYY", "...Y.", "...YY"] },
  {
    name: "Tent",
    palette: { O: ORANGE, K: BROWN },
    rows: ["..O..", ".OOO.", "OOKOO", "OKKKO", "....."],
  },
  {
    name: "Alien",
    palette: { G: LIME, K: BLACK },
    rows: [".GGG.", "GKGKG", "GGGGG", ".G.G.", "G...G"],
  },
  {
    name: "Bear",
    palette: { B: BROWN, K: BLACK, N: TAN },
    rows: ["BB.BB", "BBBBB", "BKBKB", "BBNBB", ".BBB."],
  },
  {
    name: "Cactus",
    palette: { G: GREEN, P: ORANGE },
    rows: [".G...", "GG.G.", ".GGG.", "..G..", ".PPP."],
  },
  {
    name: "Owl",
    palette: { B: BROWN, Y: YELLOW, K: BLACK, O: ORANGE },
    rows: ["BB.BB", "BBBBB", "YKBKY", "BBOBB", ".B.B."],
  },
  {
    name: "Sandcastle",
    palette: { T: TAN, D: BROWN },
    rows: [".T.T.", ".TTT.", "TTTTT", "TTDTT", "TTDTT"],
  },
  {
    name: "Mountain",
    palette: { S: SNOW, G: STEEL },
    rows: ["..S..", ".SGS.", ".GGG.", "GGGGG", "....."],
  },
];
