# 副本特殊物品效果規格（給哈基米）

> 2026-11-26，小克整理。**特殊物品效果絕對不能加副本通過率，也不能加戰力**（露葵定案）。90 件物品要各配 1 種下面的效果，名字與效果主題要對得上。
> 數字（單件預設值、總上限）是暫定值，要 sim 驗證，所以你只要選「效果種類」，**不用寫數字**（特殊情況想要比預設大或小，可以在備註寫倍率，例如 ×2、×0.5）。尾王物品引擎會自動 ×1.5。

## 一、14 種效果

| key | 名稱 | 內容 | 單件預設 | 全部加總上限 |
|---|---|---|---|---|
| `insightChance` | 💡 頓悟機率 | 通關頓悟機率 +1%。 | +1% | +10% |
| `intelGain` | 👁️ 情報獲取 | 副本情報條獲取 +3%。 | +3% | +50% |
| `healBoost` | 🩹 傷勢恢復 | 每日傷勢多降 1 級的機率 +2%。 | +2% | +25% |
| `injuryShield` | 🛡️ 傷勢減免 | 全員受傷時多 3% 機率少受一級。 | 3% | 50% |
| `rewardPct` | 💰 通關積分 | 所有副本通關積分 +3%。 | +3% | +30% |
| `sanityRegen` | 🌿 理智回復 | 留守每日理智回復 +0.25。 | +0.25 | +3 |
| `sanityGuard` | 🧘 理智守護 | 副本單房失敗理智損耗 -0.1。 | -0.1 | -2 |
| `karmaDrop` | 💎 結晶掉率 | 因果結晶機率掉落 +0.5%。 | +0.5% | +10% |
| `hiddenRoom` | 🔍 隱藏房 | 貪婪探索開出隱藏房機率 +1%。 | +1% | +15% |
| `upkeepCut` | 🧾 維持費減免 | 每日維持費 -0.5%。 | -0.5% | -10% |
| `shopDiscount` | 🏷️ 商店折扣 | 商店與黑市價格 -0.5%。 | -0.5% | -10% |
| `bondLove` | 🤝 同行情誼 | 同行情誼好感 +0.1。 | +0.1 | +2 |
| `deathSave` | 🍀 死裡逃生 | 副本戰死時鎖血免死機率 +1%。 | +1% | +10% |
| `tensionEase` | 🕊️ 張力緩和 | 人際張力事件產生率 -1%。 | -1% | -15% |

## 二、配效果的原則
- 名字對得上：腦核 → 頓悟機率、染血繃帶 → 傷勢恢復／傷勢減免、紙燈籠 → 理智守護／理智回復、義眼 → 情報獲取，這類。
- 14 種盡量都用到，同一種不要超過 10 件（太集中會被上限擋住，玩家收了沒感覺）。
- 同一個世界的 3 件盡量配不同效果。
- 不要配通過率或戰力，也不要想框架以外的新效果；真的需要新效果種類，請先跟小克說（引擎要加掛鉤）。
- **id 不要動**（`_r1`／`_r2`／`_r3` 與語意 id），舊存檔的收藏紀錄靠它。

## 三、90 件物品（目前是暫代效果，等你配好後替換）

交稿格式：每件一行「世界編號｜id｜名稱｜效果 key｜（選填）倍率或備註」。

| 世界 | id | 名稱 | 目前（暫代）效果 |
|---|---|---|---|
| ghost_village（密室殺陣） | `ghost_talisman` | 破局者手札 | insightChance |
| ghost_village（密室殺陣） | `ghost_seal` | 防爆機關護具 | injuryShield |
| ghost_village（密室殺陣） | `yin_yang_eye` | 洞悉死門之眼 | intelGain |
| ch1_02（喪屍危城） | `ch1_02_r1` | 黑血 | intelGain |
| ch1_02（喪屍危城） | `ch1_02_r2` | 碎骨刀 | rewardPct |
| ch1_02（喪屍危城） | `ch1_02_r3` | 染血繃帶 | injuryShield |
| silent_ark（猛鬼宿舍） | `ark_accelerator` | 符紙灰 | intelGain |
| silent_ark（猛鬼宿舍） | `ark_prosthetic` | 桃木釘 | injuryShield |
| silent_ark（猛鬼宿舍） | `ark_cutter` | 破銅鈴 | insightChance |
| ch1_04（絕命荒島） | `ch1_04_r1` | 鏽齒輪 | insightChance |
| ch1_04（絕命荒島） | `ch1_04_r2` | 煤灰瓶 | injuryShield |
| ch1_04（絕命荒島） | `ch1_04_r3` | 黃銅懷錶 | intelGain |
| ember_war（極寒列車） | `ember_firebolt` | 凍黑麵包 | insightChance |
| ember_war（極寒列車） | `ember_staff` | 劣質烈酒 | rewardPct |
| ember_war（極寒列車） | `ember_blood` | 列車長帽 | intelGain |
| ch1_boss（骸骨巨獸島） | `ch1_boss_r1` | 蟲母毒腺 | insightChance |
| ch1_boss（骸骨巨獸島） | `ch1_boss_r2` | 幾丁質甲 | rewardPct |
| ch1_boss（骸骨巨獸島） | `ch1_boss_r3` | 腦核 | injuryShield |
| ch2_01（漠北刀客行） | `ch2_01_r1` | 義眼 | insightChance |
| ch2_01（漠北刀客行） | `ch2_01_r2` | 廢晶片 | injuryShield |
| ch2_01（漠北刀客行） | `ch2_01_r3` | 霓虹燈管 | rewardPct |
| ch2_02（血族古堡） | `ch2_02_r1` | 鹽晶 | intelGain |
| ch2_02（血族古堡） | `ch2_02_r2` | 舊船票 | injuryShield |
| ch2_02（血族古堡） | `ch2_02_r3` | 深海藤壺 | rewardPct |
| ch2_03（黃沙古墓） | `ch2_03_r1` | 狐面 | insightChance |
| ch2_03（黃沙古墓） | `ch2_03_r2` | 紙燈籠 | injuryShield |
| ch2_03（黃沙古墓） | `ch2_03_r3` | 斷弦三味線 | rewardPct |
| ch2_04（蒸氣機甲城） | `ch2_04_r1` | 沙蟲牙 | intelGain |
| ch2_04（蒸氣機甲城） | `ch2_04_r2` | 舊水壺 | injuryShield |
| ch2_04（蒸氣機甲城） | `ch2_04_r3` | 防風鏡 | rewardPct |
| ch2_05（幽靈海盜灣） | `ch2_05_r1` | 蠟封信 | insightChance |
| ch2_05（幽靈海盜灣） | `ch2_05_r2` | 鳥嘴面具 | rewardPct |
| ch2_05（幽靈海盜灣） | `ch2_05_r3` | 放血刀 | intelGain |
| ch2_boss（熔岩龍巢） | `ch2_boss_r1` | 龍血石 | injuryShield |
| ch2_boss（熔岩龍巢） | `ch2_boss_r2` | 逆鱗 | rewardPct |
| ch2_boss（熔岩龍巢） | `ch2_boss_r3` | 斷角 | insightChance |
| ch3_01（血月霧都） | `ch3_01_r1` | 仙人骨 | insightChance |
| ch3_01（血月霧都） | `ch3_01_r2` | 廢丹渣 | intelGain |
| ch3_01（血月霧都） | `ch3_01_r3` | 斷劍穗 | injuryShield |
| ch3_02（霓虹夜城） | `ch3_02_r1` | 夢境沙 | intelGain |
| ch3_02（霓虹夜城） | `ch3_02_r2` | 陀螺 | injuryShield |
| ch3_02（霓虹夜城） | `ch3_02_r3` | 碎鏡片 | rewardPct |
| ch3_03（百鬼夜行京） | `ch3_03_r1` | 黑羽毛 | insightChance |
| ch3_03（百鬼夜行京） | `ch3_03_r2` | 荊棘冠 | injuryShield |
| ch3_03（百鬼夜行京） | `ch3_03_r3` | 告解書 | intelGain |
| ch3_04（浮空奧術塔） | `ch3_04_r1` | 輻射塵 | intelGain |
| ch3_04（浮空奧術塔） | `ch3_04_r2` | 蓋革錶 | rewardPct |
| ch3_04（浮空奧術塔） | `ch3_04_r3` | 鉛盒 | injuryShield |
| ch3_05（異星蟲巢） | `ch3_05_r1` | 金甲蟲 | injuryShield |
| ch3_05（異星蟲巢） | `ch3_05_r2` | 裹屍布 | insightChance |
| ch3_05（異星蟲巢） | `ch3_05_r3` | 法老權杖 | rewardPct |
| ch3_boss（雷鳴天空城） | `ch3_boss_r1` | 古神觸鬚 | insightChance |
| ch3_boss（雷鳴天空城） | `ch3_boss_r2` | 瘋人日記 | intelGain |
| ch3_boss（雷鳴天空城） | `ch3_boss_r3` | 黑石碑 | injuryShield |
| ch4_01（九州劍仙界） | `ch4_01_r1` | 星塵 | insightChance |
| ch4_01（九州劍仙界） | `ch4_01_r2` | 重力環 | injuryShield |
| ch4_01（九州劍仙界） | `ch4_01_r3` | 航行黑盒 | rewardPct |
| ch4_02（幽冥斷界） | `ch4_02_r1` | 血酒杯 | insightChance |
| ch4_02（幽冥斷界） | `ch4_02_r2` | 銀樁 | injuryShield |
| ch4_02（幽冥斷界） | `ch4_02_r3` | 蒼白獠牙 | intelGain |
| ch4_03（亞空間聖戰） | `ch4_03_r1` | 時之砂 | intelGain |
| ch4_03（亞空間聖戰） | `ch4_03_r2` | 斷指針 | injuryShield |
| ch4_03（亞空間聖戰） | `ch4_03_r3` | 莫比烏斯環 | rewardPct |
| ch4_04（諸神黃昏庭） | `ch4_04_r1` | 魔神灰 | insightChance |
| ch4_04（諸神黃昏庭） | `ch4_04_r2` | 勇者斷劍 | injuryShield |
| ch4_04（諸神黃昏庭） | `ch4_04_r3` | 魔王戒 | rewardPct |
| ch4_05（太古凶獸荒原） | `ch4_05_r1` | 業火種 | insightChance |
| ch4_05（太古凶獸荒原） | `ch4_05_r2` | 判官筆 | injuryShield |
| ch4_05（太古凶獸荒原） | `ch4_05_r3` | 生死簿殘頁 | intelGain |
| ch4_boss（噬界虛空淵） | `ch4_boss_r1` | 泰坦核心 | intelGain |
| ch4_boss（噬界虛空淵） | `ch4_boss_r2` | 神血結晶 | injuryShield |
| ch4_boss（噬界虛空淵） | `ch4_boss_r3` | 雷霆之矛 | rewardPct |
| ch5_01（因果時鐘塔） | `ch5_01_r1` | 維度碎片 | intelGain |
| ch5_01（因果時鐘塔） | `ch5_01_r2` | 二向箔 | injuryShield |
| ch5_01（因果時鐘塔） | `ch5_01_r3` | 觀測眼 | rewardPct |
| ch5_02（黑暗森林星海） | `ch5_02_r1` | 因果線 | insightChance |
| ch5_02（黑暗森林星海） | `ch5_02_r2` | 命運紡錘 | injuryShield |
| ch5_02（黑暗森林星海） | `ch5_02_r3` | 剪刀 | rewardPct |
| ch5_03（舊日幻夢境） | `ch5_03_r1` | 虛無結晶 | insightChance |
| ch5_03（舊日幻夢境） | `ch5_03_r2` | 反物質瓶 | injuryShield |
| ch5_03（舊日幻夢境） | `ch5_03_r3` | 白洞核 | intelGain |
| ch5_04（混沌封神劫） | `ch5_04_r1` | 舊日遺骨 | intelGain |
| ch5_04（混沌封神劫） | `ch5_04_r2` | 黃衣殘布 | insightChance |
| ch5_04（混沌封神劫） | `ch5_04_r3` | 銀鑰匙 | injuryShield |
| ch5_05（戴森機械神國） | `ch5_05_r1` | 源代碼 | intelGain |
| ch5_05（戴森機械神國） | `ch5_05_r2` | 廢棄光碟 | injuryShield |
| ch5_05（戴森機械神國） | `ch5_05_r3` | 管理員金鑰 | rewardPct |
| ch5_boss（原初神座中樞） | `ch5_boss_r1` | 主神碎片 | intelGain |
| ch5_boss（原初神座中樞） | `ch5_boss_r2` | 創世泥板 | insightChance |
| ch5_boss（原初神座中樞） | `ch5_boss_r3` | 終焉之冠 | rewardPct |
