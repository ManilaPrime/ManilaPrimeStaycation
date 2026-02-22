import ical from "node-ical"

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const REPO_OWNER = "ManilaPrime"
const REPO_NAME = "ManilaPrimeStaycation"
const BRANCH = "main"

const units = {
  S1TC2_595: "https://www.airbnb.com/calendar/ical/1530361023768759063.ics?t=baffb130590a438cac29735b143b96fe&locale=en-GB",
  S1TC2_1567: "https://www.airbnb.com/calendar/ical/1600802153832922086.ics?t=c083a5d686354f0cb6948556c957c132",
  S1TC2_1569: "https://www.airbnb.com/calendar/ical/1542649713581564854.ics?t=6d9d08b2e06a498f971b66aaf6917b22",
  S1TC2_1583: "https://www.airbnb.com/calendar/ical/1514352264532693099.ics?t=63ee007127de4958b2fff3389e160f29",
  S1TC2_1585: "https://www.airbnb.com/calendar/ical/1492660768873686668.ics?t=f7c603da55f24a15871ceb3f85ee3b40",
  S1TC2_1586: "https://www.airbnb.com/calendar/ical/1456394329482405564.ics?t=56d67dff321549a88e1b1d8a81185dfb",
  S1TC2_1839: "https://www.airbnb.com/calendar/ical/1492666082664918894.ics?t=345fa7f61fd64349ac282abc4dcc4e7d",
  S1TD_953: "https://www.airbnb.com/calendar/ical/1575381453708843835.ics?t=c4cbd8e6fd9e4e1ca371ce847b826a97",
  S1TD_963: "https://www.airbnb.com/calendar/ical/1550363204882077789.ics?t=480c2289ebd649e690ae76ab62d2b49f",
  S3T1_372: "https://www.airbnb.com/calendar/ical/1550714503840063391.ics?t=8c87fe6c5145401fa2f6a37ddb3bb2e2",
  S3T1_525: "https://www.airbnb.com/calendar/ical/1573584451241601621.ics?t=50178d21eec548e5a8ca38862a3ecc55",
  S3T1_855: "https://www.airbnb.com/calendar/ical/1521108058648348925.ics?t=ddc07a9f4efb45d7bc55fcd79084690d",
}

async function uploadToGitHub(path, content) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`

  // Check if file exists (to get SHA)
  const existing = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`
    }
  })

  let sha = null
  if (existing.ok) {
    const data = await existing.json()
    sha = data.sha
  }

  await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: `Update ${path}`,
      content: Buffer.from(content).toString("base64"),
      branch: BRANCH,
      sha
    })
  })
}

export default async function handler(req, res) {
  try {
    const results = {}

    for (const [unit, url] of Object.entries(units)) {
      const data = await ical.async.fromURL(url)

      const bookings = Object.values(data)
        .filter(e => e.type === "VEVENT" && e.start && e.end)
        .filter(e => e.status !== "CANCELLED") // remove cancelled stays
        .map(e => ({
          start: new Date(e.start).toISOString().split("T")[0],
          end: new Date(e.end).toISOString().split("T")[0]
        }))
        .sort((a, b) => new Date(a.start) - new Date(b.start))

      await uploadToGitHub(
        `data/${unit}.json`,
        JSON.stringify(bookings, null, 2)
      )

      results[unit] = "synced"
    }

    res.status(200).json({
      message: "All calendars synced",
      results
    })

  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
