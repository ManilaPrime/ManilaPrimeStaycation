import ical from "node-ical"

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const REPO_OWNER = "YOUR_GITHUB_USERNAME"
const REPO_NAME = "YOUR_REPO_NAME"
const BRANCH = "main"

const units = {
  S1TC2_595: "AIRBNB_ICS_LINK_HERE",
  S1TC2_1567: "AIRBNB_ICS_LINK_HERE",
  S1TC2_1569: "AIRBNB_ICS_LINK_HERE",
  S1TC2_1583: "AIRBNB_ICS_LINK_HERE",
  S1TC2_1585: "AIRBNB_ICS_LINK_HERE",
  S1TC2_1586: "AIRBNB_ICS_LINK_HERE",
  S1TC2_1839: "AIRBNB_ICS_LINK_HERE",
  S1TD_953: "AIRBNB_ICS_LINK_HERE",
  S1TD_963: "AIRBNB_ICS_LINK_HERE",
  S3T1_372: "AIRBNB_ICS_LINK_HERE",
  S3T1_525: "AIRBNB_ICS_LINK_HERE",
  S3T1_855: "AIRBNB_ICS_LINK_HERE",
  bedspace: "AIRBNB_ICS_LINK_HERE"
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
        .filter(e => e.type === "VEVENT")
        .map(e => ({
          start: e.start,
          end: e.end
        }))

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
