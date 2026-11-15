// 5:2:1 純血無限流人際事件池（Phase 4-E-3）。要加事件、換文案只改這個檔案；機制（誰能演、效果怎麼套）在 engine/drama.js。
//
// 三個群組嚴格維持權重 5 : 2 : 1（CONFIG.drama.groupWeights）：
//   bond      熱血羈絆／戰友日常（5）：指導、慶功、結搭檔、緬懷亡友，不只有互捅，更有熱血戰友情
//   friction  派系摩擦／抓包對質（2）：批鬥大會、強者嘲諷、黑貨事發、隊長偏心
//   melee     八點檔修羅場／噬主之夜（權重 1，共 11 則；其中 8 則是小克初稿，待哈基米潤飾）：夜襲刺殺隊長、三角暗戀、替身泥人被本尊撞破
//
// 欄位：
//   id / group / name
//   cast    選角方式（engine/drama.js 的 CASTS）：pair／friends／bestFriends／mentor／wounded／lowSanity／all／memorial／captainAndOne／hoarder／taunt／contraband／captainBias／quarrel／conspire／triangle／doll
//   style   只有這個流派才會發生（可省略）
//   when    "day" 只在每日結算觸發、"run" 只在副本成功結算觸發（可省略 = 都行）
//   fx      效果（engine/drama.js 的 applyEvent）：love／aff／hate［A→B, B→A］、hateAC（A 與 C 互相仇恨）、sanityA／sanityB／sanityAll、healB、partner、seize、fund（互助金充公比例）、exposed
//   chronicle  true = 同時寫進《空間編年史》
//   texts   多版本模板：{A}{B}{C} 是輪迴者名字，{n}{amount} 是數字

export const DRAMA_EVENTS = [
  // ═════════ 熱血羈絆／戰友日常（15，權重 5）═════════
  {
    id: "mentor_train", group: "bond", name: "老鳥指導菜鳥特訓", cast: "mentor",
    fx: { love: [4, 8], sanityB: 10 },
    texts: [
      "💪 老鳥 {A} 抓著菜鳥 {B} 特訓了一整晚：「先學會怎麼活著回來，再學怎麼殺怪。」{B} 累癱了，但眼神亮了。",
      "💪 {A} 把自己的保命心得掰開揉碎教給 {B}。{B} 邊記筆記邊哭，心情卻莫名踏實了。",
      "💪 「站穩，重心壓低！」{A} 把 {B} 操到腿軟，卻在收操時偷偷遞了一瓶水。主神監控室一片感動（偽）。",
    ],
  },
  {
    id: "victory_feast", group: "bond", name: "劫後餘生慶功宴", cast: "all", when: "run",
    fx: { sanityAll: 6, loveAll: 3 },
    texts: [
      "🍻 全員活著回來了！{A} 不知從哪摸出一箱罐頭，大家圍著吃了一頓這輩子最香的慶功宴。",
      "🍻 {A} 舉著罐頭高喊：「敬還能呼吸的我們！」所有人哄堂大笑，理智都回了一截。",
      "🍻 劫後餘生，{A} 張羅了一桌「主神牌合成料理」。味道像紙板，但大家吃得熱淚盈眶。",
    ],
  },
  {
    id: "life_death_pact", group: "bond", name: "結為生死搭檔", cast: "bestFriends", chronicle: true,
    fx: { love: [6, 6], partner: true },
    texts: [
      "🤝 {A} 與 {B} 在走廊盡頭擊掌立誓：「你的後背歸我，我的後背歸你。」從今天起，他們是生死搭檔，同隊出征戰力小幅提升。",
      "🤝 {B} 把最後一塊壓縮乾糧掰成兩半，遞給 {A}。沒人說話，但空間裡多了一對生死搭檔。",
      "🤝 「要死一起死。」「呸，要活一起活。」{A} 與 {B} 結成生死搭檔，連主神都忍不住多看了兩眼。",
    ],
  },
  {
    id: "polish_relic", group: "bond", name: "擦拭亡友遺物", cast: "memorial",
    fx: { sanityA: 8 },
    texts: [
      "🕯️ {A} 坐在角落，一遍又一遍擦拭著亡友留下的遺物。擦完了，他站起來，眼神比之前堅定。",
      "🕯️ {A} 對著遺物低聲說了句「我會替你活到最後」，然後把它收進懷裡。理智穩了。",
      "🕯️ 深夜，{A} 摩挲著亡友的舊物，嘴角竟然有一絲笑。有些人，是靠記得一個人活下去的。",
    ],
  },
  {
    id: "night_watch", group: "bond", name: "守夜交班", cast: "friends",
    fx: { love: [5, 5], sanityB: 3 },
    texts: [
      "🌙 {A} 接下了 {B} 的夜班，還替他蓋了毯子。{B} 假裝睡著，其實嘴角偷偷上揚。",
      "🌙 輪班時 {A} 與 {B} 聊了整整兩個小時，聊到最後誰也不記得在聊什麼，只記得很安心。",
      "🌙 {B} 守夜睏得點頭，{A} 默默把他推去睡，自己扛下整晚。兄弟，是這麼當的。",
    ],
  },
  {
    id: "share_ration", group: "bond", name: "分享口糧", cast: "pair",
    fx: { love: [3, 6], sanityB: 4 },
    texts: [
      "🍙 {A} 把自己那份熱的口糧推給 {B}：「我吃過了。」（沒有，他餓著肚子。）",
      "🍙 {B} 餓得眼冒金星，{A} 掏出藏了三天的巧克力。{B} 感動到想改姓。",
      "🍙 {A} 分了半包泡麵給 {B}，順便附贈一句：「別告訴別人我心軟。」",
    ],
  },
  {
    id: "campfire_talk", group: "bond", name: "圍爐夜話", cast: "all", when: "day",
    fx: { sanityAll: 4, loveAll: 2 },
    texts: [
      "🔥 {A} 起了個頭，大家圍成一圈講起各自上輩子最糗的事。笑聲在白色空間裡迴盪了很久。",
      "🔥 空間裡難得的平靜夜晚。{A} 講了個爛笑話，沒人覺得好笑，但所有人都笑了。",
      "🔥 {A} 說：「我們這群人，大概是主神手下最不專業的一組。」「所以才活到現在啊。」全場乾杯。",
    ],
  },
  {
    id: "friendly_spar", group: "bond", name: "友誼切磋", cast: "pair",
    fx: { love: [3, 3], sanityA: 2, sanityB: 2 },
    texts: [
      "🥋 {A} 與 {B} 在訓練場切磋，打得鼻青臉腫，最後癱在地上笑成一團。",
      "🥋 「這招你剛剛用過了！」{A} 與 {B} 邊打邊吵，結束時互相攙扶著去吃宵夜。",
      "🥋 一場點到為止的切磋，卻讓 {A} 與 {B} 發現對方比想像中可靠。",
    ],
  },
  {
    id: "patch_up", group: "bond", name: "替戰友包紮", cast: "wounded",
    fx: { love: [4, 8], healB: 1 },
    texts: [
      "🩹 {A} 熟練地替 {B} 重新包紮傷口：「忍著點。」{B} 咬著牙，傷勢緩和了一些。",
      "🩹 {B} 的傷口沒人管，{A} 看不下去，拎著急救包衝了過來。包紮手法專業得像前任軍醫。",
      "🩹 {A} 一邊替 {B} 換藥一邊碎碎念：「下次躲快一點啊。」{B} 低著頭，眼眶有點紅。",
    ],
  },
  {
    id: "pull_up", group: "bond", name: "低谷拉一把", cast: "lowSanity",
    fx: { love: [3, 8], sanityB: 12 },
    texts: [
      "🫂 {B} 縮在角落快撐不下去，{A} 一屁股坐到他旁邊：「不用說話，我陪你。」",
      "🫂 {A} 拖著失魂落魄的 {B} 去喝了杯熱飲：「你還活著，這比什麼都強。」{B} 慢慢緩了過來。",
      "🫂 {A} 把 {B} 從崩潰邊緣拉了回來，用的是最笨的方法——一句「我在」。",
    ],
  },
  {
    id: "toast_the_dead", group: "bond", name: "舉杯敬亡友", cast: "memorialAll",
    fx: { sanityAll: 3 },
    texts: [
      "🥂 {A} 在英靈碑前倒了一杯水：「敬沒能回來的人。」所有人沉默地舉了杯。",
      "🥂 {A} 帶著大家對著空椅子乾杯：「你的份，我們替你活。」",
      "🥂 夜裡，{A} 把亡友的名字念了一遍。念完了，大家的肩膀都鬆了一點。",
    ],
  },
  {
    id: "gift_swap", group: "bond", name: "互贈小物", cast: "pair",
    fx: { love: [6, 6] },
    texts: [
      "🎁 {A} 與 {B} 同時掏出一個小東西遞給對方，兩人愣了一秒，然後一起笑出聲。",
      "🎁 {A} 送了 {B} 一枚從副本帶回來的石頭：「長得像你。」{B} 回敬了一條破圍巾：「像你。」",
      "🎁 在這個什麼都會死的地方，{A} 與 {B} 交換了兩個毫無用處卻很珍貴的小東西。",
    ],
  },
  {
    id: "rookie_boast", group: "bond", name: "菜鳥吹牛被捧場", cast: "mentor",
    fx: { love: [2, 6], sanityB: 6 },
    texts: [
      "🎤 菜鳥 {B} 吹噓自己「一個人打倒三隻怪」，老鳥 {A} 憋著笑點頭：「對，你最強。」{B} 開心得像中了彩券。",
      "🎤 {B} 眉飛色舞講著自己的英勇事蹟，{A} 配合地驚呼「哇」。旁邊的人都在偷笑。",
      "🎤 {A} 沒戳破 {B} 的牛皮，只默默把保命口訣塞進他口袋。這就是老鳥的溫柔。",
    ],
  },
  {
    id: "captain_pep", group: "bond", name: "隊長打氣", cast: "captainAndOne",
    fx: { aff: [0, 4], sanityB: 8 },
    texts: [
      "📣 隊長 {A} 拍了拍 {B} 的肩：「這隊有你，我才敢睡覺。」{B} 挺直了腰桿。",
      "📣 {A} 在全隊面前點名表揚 {B}，{B} 臉紅得像蝦子，士氣卻飆上天。",
      "📣 「別怕，天塌下來我先頂。」隊長 {A} 對 {B} 說完這句話，轉身就去訓練了。",
    ],
  },
  {
    id: "late_confide", group: "bond", name: "深夜談心", cast: "friends",
    fx: { love: [6, 6], sanityA: 3, sanityB: 3 },
    texts: [
      "💬 {A} 與 {B} 在走廊坐到天亮，聊起上輩子沒說出口的遺憾。誰也沒有笑對方。",
      "💬 「說真的，我怕死。」{A} 說。「我也是。」{B} 答。然後兩個人都鬆了一口氣。",
      "💬 {B} 向 {A} 吐露了藏很久的心事，{A} 只回了一句：「我懂。」這就夠了。",
    ],
  },

  // ═════════ 派系摩擦／抓包對質（6，權重 2）═════════
  {
    id: "struggle_session", group: "friction", name: "共產隊批鬥大會", cast: "hoarder", style: "communal", chronicle: true,
    fx: { fund: 0.5, sanityA: -8, affAll: [-4, 0] },
    texts: [
      "📢 互助隊緊急召開批鬥大會！{A} 私藏小金庫被當場揪出，{amount} 分充公進互助金，他低著頭一句話也不敢說。",
      "📢 「同志，大鍋飯是用來吃的，不是用來藏的！」{A} 被眾人圍著上了一堂「集體主義公開課」，{amount} 分入了互助金。",
      "📢 {A} 的小金庫被翻出來示眾。{amount} 分當場歸公，批鬥結束後，他獨自在角落反省了很久。",
    ],
  },
  {
    id: "elite_taunt", group: "friction", name: "菁英隊強者嘲諷弱者", cast: "taunt", style: "elite",
    fx: { hate: [0, 8], sanityB: -6 },
    texts: [
      "😈 強者 {A} 瞥了一眼 {B} 的戰績，輕蔑地笑了：「這種貨色也配和我同隊。」{B} 拳頭握緊又鬆開。",
      "😈 {A} 當眾點評 {B} 的戰力：「拖油瓶。」全場安靜，{B} 低下頭，理智受挫。",
      "😈 {A} 把訓練場讓給「真正有資格的人」，順便踢了 {B} 一腳。叢林法則，沒什麼好說的。",
    ],
  },
  {
    id: "contraband_exposed", group: "friction", name: "黑貨事發對質", cast: "contraband",
    fx: { aff: [-15, -25], sanityA: -6, exposed: true },
    texts: [
      "🕵️ {A} 暗中使用黑貨的事被 {B} 發現了！兩人在走廊對質，場面劍拔弩張。",
      "🕵️ 「你對我做了什麼？」{B} 把證據摔在 {A} 面前。{A} 結結巴巴，無從辯解，兩人的關係震盪不已。",
      "🕵️ 黑貨的包裝紙被 {B} 撿到了。{A} 百口莫辯，只好一個勁地說「誤會」。",
    ],
  },
  {
    id: "captain_bias", group: "friction", name: "隊長偏心風波", cast: "captainBias",
    fx: { aff: [-6, 0], sanityB: -3 },
    texts: [
      "😒 {B} 發現隊長 {A} 又把好裝備留給自己人，臉色鐵青。隊內氣氛一下降到冰點。",
      "😒 「憑什麼他有份我沒有？」{B} 在背後嘀咕，被 {A} 聽見了，場面尷尬。",
      "😒 隊長 {A} 分東西時明顯偏心，{B} 沒說話，但記在了心裡。",
    ],
  },
  {
    id: "loot_quarrel", group: "friction", name: "分贓爭執", cast: "quarrel",
    fx: { hate: [0, 6], sanityA: -3, sanityB: -3 },
    texts: [
      "💢 {A} 與 {B} 為了誰多拿幾分吵了起來，從「你有沒有出力」吵到「你上輩子欠我」。",
      "💢 {B} 的私房錢明顯比 {A} 少一截，{B} 陰陽怪氣地說了句「有錢人」，兩人不歡而散。",
      "💢 分贓不均永遠是團隊殺手。{A} 與 {B} 互相甩臉色，整個空間都能感受到低氣壓。",
    ],
  },
  {
    id: "pig_grumble", group: "friction", name: "肉豬私下抱怨", cast: "pigGrumble", style: "farming",
    fx: { aff: [-4, 0], sanityA: -4 },
    texts: [
      "🐖 {A} 在角落小聲罵隊長 {B}：「我們拼死拼活，他躺著數錢！」話音剛落，背後傳來咳嗽聲。",
      "🐖 {A} 偷偷在牆上畫了隊長 {B} 的小人，插滿了針。養殖流的日常怨念值又上升了。",
      "🐖 「下次他死了，我第一個放鞭炮。」{A} 對著 {B} 的背影咬牙切齒。",
    ],
  },

  // ═════════ 八點檔修羅場／噬主之夜（3，權重 1）═════════
  {
    id: "coup_night", group: "melee", name: "噬主夜襲", cast: "conspire", chronicle: true,
    fx: { special: "coupNight" },
    texts: [
      "🗡️ 深夜，{n} 名心懷怨恨的隊員合謀闖進隊長 {B} 的房間，領頭的是 {A}！刀光劍影，一夜驚魂。",
      "🗡️ 「你吃肉，我們喝湯，今天換你嚐嚐被剝削的滋味。」{A} 帶著 {n} 人殺向隊長 {B}。",
      "🗡️ 主神空間迎來一個血腥之夜：{A} 領著 {n} 位被壓榨的同伴，對隊長 {B} 發動夜襲！",
    ],
  },
  {
    id: "love_triangle", group: "melee", name: "三角暗戀修羅場", cast: "triangle", chronicle: true,
    fx: { hateAC: 10, sanityA: -5, sanityB: -3, sanityC: -5 },
    texts: [
      "💘 {A} 與 {C} 同時向 {B} 表白，兩人當場對峙。{B} 夾在中間，笑容越來越僵。",
      "💘 {A} 發現 {C} 也暗戀著 {B}。走廊裡溫度驟降，連主神都搬了小板凳在監控室看戲。",
      "💘 「你憑什麼跟我搶 {B}？」{A} 怒視 {C}。{B} 默默退後半步，打算裝死。",
    ],
  },
  {
    id: "doll_exposed", group: "melee", name: "催生黑貨被本尊撞破", cast: "doll", chronicle: true,
    fx: { aff: [-20, -20], hate: [0, 20], sanityA: -10, exposed: true },
    texts: [
      "🎎 {A} 偷偷下了催生黑貨，被 {B} 撞個正著！{B} 看著那包還沒拆乾淨的禁忌藥粉，氣得渾身發抖。",
      "🎎 「你給我下的是什麼？」{B} 舉著 {A} 遺落的藥包，聲音顫抖。修羅場，正式開演。",
      "🎎 {A} 的小動作被 {B} 當場抓包。{B} 沉默了三秒，然後說：「我們來聊聊。」",
    ],
  },
  // ── 以下 8 則：標題與文案已換成哈基米第二批稿（第四批）；小克初稿的 fx／cast 保留。替身文學、爭奪遺產的文案要 {A}{B}{C} 三個不同的人，所以 cast 改成 "trio" ──
  {
    id: "cheat_caught", group: "melee", name: "抓姦在床", cast: "triangle", chronicle: true,
    fx: { aff: [-25, -10], hateAC: 5, sanityA: -8, sanityB: -4, sanityC: -8 },
    texts: [
      "💔 {A} 提早結束特訓回房，竟撞見 {B} 與 {C} 衣衫不整地鎖在休眠艙裡測試「雙人共振率」，當場拔刀劈碎了艙門！",
      "💔 {A} 翻看公共帳本時發現 {B} 偷偷用公款給 {C} 買了三套情趣防具，氣得在主神廣場直接廣播兩人的私密聊天紀錄！",
      "💔 原本說好在安全屋輪流守夜，{A} 卻抓包 {B} 跟 {C} 躲在儲藏室裡嘴對嘴餵食回血藥，瞬間引爆全隊火拼！",
    ],
  },
  {
    id: "fake_pregnancy", group: "melee", name: "假孕逼宮", cast: "friends", chronicle: true,
    fx: { aff: [-10, -30], hate: [0, 15], sanityA: -3, sanityB: -10 },
    texts: [
      "🤰 {B} 拿著用紅筆畫出兩條線的劣質驗孕棒衝進會議室，哭喊肚裡懷了 {A} 的高階血統繼承人，逼 {A} 立刻把隊長位置讓出來！",
      "🤰 才剛打完異形副本，{B} 就宣稱自己嘔吐不止是懷了 {A} 的骨肉，結果被醫務室踢爆肚子裡只是塞了一顆還沒消化的寄生蟲卵！",
      "🤰 {B} 當眾挺著抱枕假裝懷孕八個月，威脅 {A} 若不交出私房錢買安胎神裝，就要去主神投訴中心告他始亂終棄！",
    ],
  },
  {
    id: "impostor", group: "melee", name: "替身文學", cast: "trio",
    fx: { aff: [0, -25], hate: [0, 20], sanityA: -2, sanityB: -8 },
    texts: [
      "🎭 {A} 醉酒後抱著 {B} 痛哭流涕，嘴裡喊的卻全是死去前任 {C} 的名字，{B} 氣得當場把醒酒湯連鍋扣在 {A} 頭上！",
      "🎭 {B} 偶然發現 {A} 之所以每天送自己昂貴耗材，只是因為自己的背影跟陣亡的 {C} 有八分像，憤而把禮物全數丟進黑洞垃圾桶！",
      "🎭 {A} 強迫 {B} 在出任務時必須戴上 {C} 生前最愛的狐狸面具，{B} 忍無可忍，在 BOSS 戰開場時直接一腳把 {A} 踹進火坑！",
    ],
  },
  {
    id: "heir_claim", group: "melee", name: "滴血認親", cast: "pair", chronicle: true,
    fx: { aff: [-5, -20], sanityA: -3, sanityB: -12 },
    texts: [
      "🩸 {B} 突然掏出一把生鏽匕首割破手指，非說自己流著與 {A} 相同的遠古神族血脈，要求平分 {A} 個人金庫裡的所有高階遺物！",
      "🩸 看到 {A} 剛開出頂級血統，{B} 立刻抱住 {A} 的大腿痛哭認爹，聲稱自己是他失散多年的異父異母親生骨肉！",
      "🩸 {B} 拿著一張用小畫家合成的族譜大鬧復活碑，硬說 {A} 是自家祖墳爬出來的老祖宗，逼 {A} 為自己全額報銷破鎖費用！",
    ],
  },
  {
    id: "inheritance_fight", group: "melee", name: "爭奪遺產", cast: "trio", chronicle: true,
    fx: { aff: [-15, -15], hate: [10, 10], sanityA: -6, sanityB: -6 },
    texts: [
      "⚰️ {A} 在副本裡才剛斷氣還沒涼透，{B} 跟 {C} 就已經在屍體旁邊為了搶他手上的空間戒指大打出手，連復活幣都忘了投！",
      "⚰️ 趁著 {A} 重傷昏迷被推進修復艙，{B} 與 {C} 連夜拿著撬棍去撬 {A} 的私人保險箱，結果因為分贓不均在走廊互轟火球！",
      "⚰️ {A} 只是去上個廁所太久被系統誤判失蹤，回來就看見 {B} 跟 {C} 正拿著粉筆在自己房間地板上畫線分家產！",
    ],
  },
  {
    id: "bestie_steal", group: "melee", name: "閨蜜背刺", cast: "triangle", chronicle: true,
    fx: { hateAC: 20, sanityA: -6, sanityC: -6 },
    texts: [
      "🗡️ {B} 白天還在幫 {A} 痛罵 {C} 是個騙財騙色的渣滓，半夜就被抓到自己偷偷摸進 {C} 房間幫忙擦拭高階武器！",
      "🗡️ {A} 把暗戀 {C} 的情書交給摯友 {B} 幫忙轉交，結果隔天卻看到 {B} 跟 {C} 手牽手去主神商店買情侶綁定戒指！",
      "🗡️ 身為 {A} 最信任的死黨，{B} 竟然在修羅場投票時反手把關鍵一票投給了宿敵 {C}，只因為 {C} 私下塞給他兩件紫裝！",
    ],
  },
  {
    id: "undercover_exposed", group: "melee", name: "臥底曝光", cast: "captainAndOne", chronicle: true,
    fx: { aff: [-20, -10], hate: [10, 0], sanityB: -10 },
    texts: [
      "🕵️ {A} 洗澡時不小心掉出了洲際宿敵小隊的聯絡徽章，被路過的 {B} 撿個正著，全隊瞬間拔槍將 {A} 團團包圍！",
      "🕵️ 決戰前夕，{B} 發現隊伍的公共傳送座標被人偷偷改成了敵方伏擊點，順著系統日誌一查，內鬼竟然是一直裝乖的 {A}！",
      "🕵️ {A} 趁夜深人靜躲在廁所給敵對隊長發送小隊弱點報告，結果忘了關公頻麥克風，被全隊隊員聽得一清二楚！",
    ],
  },
  {
    id: "backfire", group: "melee", name: "迴力鏢打臉", cast: "pair",
    fx: { hate: [20, 0], sanityA: -12, sanityB: -2 },
    texts: [
      "🪃 {A} 才剛在出征前大言不慚地嘲笑 {B} 買保命道具是懦夫行為，結果進副本第一間房就踩中即死陷阱，哭著求 {B} 分他半顆復活藥！",
      "🪃 {A} 當眾立下毒誓說要是打輸這場就倒立吃鍵盤，結果開場三秒就被 BOSS 一巴掌拍進牆裡摳都摳不出來，{B} 已經默默把鍵盤擺在他臉旁邊了！",
      "🪃 {A} 為了陷害 {B} 特地在飲水機裡下了強力瀉藥，卻因為記錯杯子顏色自己一口氣乾了三大杯，整場任務都在裝甲褲裡拉得驚天動地！",
    ],
  },
];

export const DRAMA_GROUPS = ["bond", "friction", "melee"];
export const eventsOfGroup = (g) => DRAMA_EVENTS.filter((e) => e.group === g);
