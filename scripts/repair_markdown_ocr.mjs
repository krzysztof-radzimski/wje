#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const write = process.argv.includes("--write");

// Only corrections whose reading is unambiguous from the immediate context are
// included here. Historical spellings, abbreviations, editorial brackets and
// manuscript cancellations deliberately remain untouched.
const corrections = [
  ["VOLUME02.md", "k0ingdom", "kingdom"],
  ["VOLUME12.md", "p. l22c", "p. 122c"],
  ["VOLUME14.md", "beause they very often", "because they very often"],
  ["VOLUME22.md", "aany mediatour", "any mediatour"],
  ["VOLUME22.md", "things that have been said thatg. there is", "things that have been said that. there is"],
  ["VOLUME31.md", "frokm the first Promise", "from the first Promise"],
  ["VOLUME31.md", "is arried on through successive ages", "is carried on through successive ages"],
  ["VOLUME31.md", "in somke Cases", "in some Cases"],
  ["VOLUME31.md", "&cthan the first way", "&c. than the first way"],
  ["VOLUME31.md", "the Empe rour Justinian", "the Emperor Justinian"],
  ["VOLUME31.md", "sp0eak of the continued", "speak of the continued"],
  ["VOLUME31.md", "marrie3d after their Ordination", "married after their Ordination"],
  ["VOLUME31.md", "Claimed the author8ty & Jurisdiction", "Claimed the authority & Jurisdiction"],
  ["VOLUME32.md", "Certain thruth which", "Certain truth which"],
  ["VOLUME32.md", "Controversy betweee", "Controversy between"],
  ["VOLUME32.md", "& ttis to be hoped", "& 'tis to be hoped"],
  ["VOLUME32.md", "as thte Rest of the Family", "as the Rest of the Family"],
  ["VOLUME32.md", "of the dispositions of thte Heart", "of the dispositions of the Heart"],
  ["VOLUME32.md", "Parts of thte Counties", "Parts of the Counties"],
  ["VOLUME32.md", "tha thave been instructed", "that have been instructed"],
  ["VOLUME32.md", "teir dissatisfac-", "their dissatisfac-"],
  ["VOLUME32.md", "tha tshould hiner", "that should hinder"],
  ["VOLUME32.md", "therre is Such", "there is Such"],
  ["VOLUME32.md", "God heas Cover’d", "God has Cover’d"],
  ["VOLUME40.md", "had maried. solomon", "had married. solomon"],
  ["VOLUME41.md", "a gret aversion", "a great aversion"],
  ["VOLUME42.md", "a death beed", "a death bed"],
  ["VOLUME43.md", "River is alwaiys flowing", "River is always flowing"],
  ["VOLUME43.md", "middle state betweeen these", "middle state between these"],
  ["VOLUME43.md", "monly to Converse", "only to Converse"],
  ["VOLUME43.md", "heart aupon worldly", "heart upon worldly"],
  ["VOLUME44.md", "wh7at there is", "what there is"],
  ["VOLUME44.md", "Even aabout fundamentals", "Even about fundamentals"],
  ["VOLUME45.md", "therefore thta desireth", "therefore that desireth"],
  ["VOLUME45.md", "subject to X Governmt. withoug a Great", "subject to X Governmt. without a Great"],
  ["VOLUME46.md", "him thpat sent him", "him that sent him"],
  ["VOLUME47.md", "the9Chap .", "the 9 Chap ."],
  ["VOLUME47.md", "persons fronm their sloth", "persons from their sloth"],
  ["VOLUME47.md", "Redemption whch his son", "Redemption which his son"],
  ["VOLUME47.md", "benefits that his peple Need", "benefits that his people Need"],
  ["VOLUME48.md", "Rewarded in whtat is", "Rewarded in what is"],
  ["VOLUME48.md", "in thyir wicked heart", "in their wicked heart"],
  ["VOLUME48.md", "the mmost Remarkeable Trial", "the most Remarkeable Trial"],
  ["VOLUME48.md", "we shouls Love to own", "we should Love to own"],
  ["VOLUME49.md", "& whouse mouths had not", "& whose mouths had not"],
  ["VOLUME48.md", "serve & hilp them", "serve & help them"],
  ["VOLUME49.md", "we shouls Love to own", "we should Love to own"],
  ["VOLUME49.md", "them throgh all ages", "them through all ages"],
  ["VOLUME49.md", "have muuch more Clear Light", "have much more Clear Light"],
  ["VOLUME50.md", "what has beeen said this day", "what has been said this day"],
  ["VOLUME50.md", "Gods sp. yoou may", "Gods sp. you may"],
  ["VOLUME50.md", "objec. agsin for", "objec. again for"],
  ["VOLUME50.md", "vicious Persons hefore them", "vicious Persons before them"],
  ["VOLUME51.md", "think thtings are so", "think things are so"],
  ["VOLUME50.md", "He is thyre Father", "He is thy Father"],
  ["VOLUME50.md", "he thingks that that", "he thinks that that"],
  ["VOLUME50.md", "been wothout assistance", "been without assistance"],
  ["VOLUME50.md", "be udner far Greater", "be under far Greater"],
  ["VOLUME50.md", "in antoher T", "in another T"],
  ["VOLUME51.md", "you mifht have your true Choice", "you might have your true Choice"],
  ["VOLUME32.md", "you msut have in your own Mind", "you must have in your own Mind"],
  ["VOLUME45.md", "is foundd meerly", "is founded meerly"],
  ["VOLUME50.md", "sp. againsst his People", "sp. against his People"],
  ["VOLUME50.md", "fighting afainst G.", "fighting against G."],
  ["VOLUME50.md", "differs fromo spiritual", "differs from spiritual"],
  ["VOLUME54.md", "a littled difficulty", "a little difficulty"],
  ["VOLUME51.md", "a Dull & De3ad time", "a Dull & Dead time"],
  ["VOLUME51.md", "will you there3f. Ruin", "will you theref. Ruin"],
  ["VOLUME51.md", "built all thngs", "built all things"],
  ["VOLUME51.md", "nothing to him athey Can do", "nothing to him that they Can do"],
  ["VOLUME51.md", "natrual man nver sincerely", "natural man never sincerely"],
  ["VOLUME51.md", "declare & speek of em", "declare & speak of em"],
  ["VOLUME51.md", "success of theiir Labours", "success of their Labours"],
  ["VOLUME52.md", "is that alone that alove that", "is that alone that alone that"],
  ["VOLUME52.md", "some that thave Great fears", "some that have Great fears"],
  ["VOLUME53.md", "yet thhis is not sufficient", "yet this is not sufficient"],
  ["VOLUME53.md", "grapple with thhe distemper", "grapple with the distemper"],
  ["VOLUME53.md", "leaving all thhe T", "leaving all the T"],
  ["VOLUME53.md", "but they will have thhe same", "but they will have the same"],
  ["VOLUME53.md", "all thhe house of Jeroboam", "all the house of Jeroboam"],
  ["VOLUME53.md", "changed into thhe same image", "changed into the same image"],
  ["VOLUME53.md", "next Head thind proposed", "next Head thing proposed"],
  ["VOLUME54.md", "none wouuld ever here thought", "none would ever here thought"],
  ["VOLUME54.md", "G smiled upen", "G smiled upon"],
  ["VOLUME54.md", "a Great thjing for a Person", "a Great thing for a Person"],
  ["VOLUME55.md", "II use mmay be", "II use may be"],
  ["VOLUME55.md", "by X ithat is said", "by X that is said"],
  ["VOLUME55.md", "what thhey shall Know", "what they shall Know"],
  ["VOLUME57.md", "ill will againwst your neigh.", "ill will against your neigh."],
  ["VOLUME63.md", "giving up oour selves", "giving up our selves"],
  ["VOLUME63.md", "what those thingss that", "what those things that"],
  ["VOLUME65.md", "live uknder the Gospel", "live under the Gospel"],
  ["VOLUME65.md", "made blessing to othes", "made blessing to others"],
  ["VOLUME65.md", "some motive3s to diswade", "some motives to diswade"],
  ["VOLUME66.md", "falling of the wiall.", "falling of the will."],
  ["VOLUME66.md", "in whaqt manner", "in what manner"],
  ["VOLUME66.md", "as wehen the Ark", "as when the Ark"],
  ["VOLUME66.md", "improve thieir pres.", "improve their pres."],
  ["VOLUME67.md", "off thte great concern", "off the great concern"],
  ["VOLUME68.md", "54 &cwhy do ye", "54 &c. why do ye"],
  ["VOLUME71.md", "way tohat misery", "way that misery"],
  ["VOLUME71.md", "ordering. vthis is", "ordering. this is"],
];

const ligatures = [
  ["VOLUME26.md", "ﬁ", "fi"],
  ["VOLUME26.md", "ﬂ", "fl"],
];

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function applyExactReplacement(file, source, replacement) {
  const target = path.join("MD", file);
  const text = fs.readFileSync(target, "utf8");
  const count = countOccurrences(text, source);
  if (count === 0) {
    return `${target}: ${JSON.stringify(source)} is already corrected or absent`;
  }
  if (count !== 1) {
    throw new Error(`${target}: expected one occurrence of ${JSON.stringify(source)}, found ${count}`);
  }
  const updated = text.replace(source, replacement);
  if (write) fs.writeFileSync(target, updated, "utf8");
  return `${target}: ${JSON.stringify(source)} → ${JSON.stringify(replacement)}`;
}

function applyLigatureReplacement(file, source, replacement) {
  const target = path.join("MD", file);
  const text = fs.readFileSync(target, "utf8");
  const count = countOccurrences(text, source);
  if (count === 0) return `${target}: ${JSON.stringify(source)} is already normalized`;
  const updated = text.split(source).join(replacement);
  if (write) fs.writeFileSync(target, updated, "utf8");
  return `${target}: normalized ${count}× ${JSON.stringify(source)} → ${JSON.stringify(replacement)}`;
}

try {
  const changes = [
    ...ligatures.map(([file, source, replacement]) => applyLigatureReplacement(file, source, replacement)),
    ...corrections.map(([file, source, replacement]) => applyExactReplacement(file, source, replacement)),
  ];
  console.log(`${write ? "Applied" : "Validated"} ${changes.length} conservative OCR repairs.`);
  for (const change of changes) console.log(change);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
