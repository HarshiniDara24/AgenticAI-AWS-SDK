const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const REGION = process.env.AWS_REGION || "us-east-1";

// Bedrock Client
const bedrockClient = new BedrockRuntimeClient({ region: REGION });

// Claude Call Helper 
async function callClaude(prompt) {
  const modelId = "anthropic.claude-3-haiku-20240307-v1:0";

  const command = new InvokeModelCommand({
    modelId,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 2000,
      temperature: 0.7,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      ],
    }),
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  // Claude outputs structured text
  return responseBody.content[0].text;
}


function extractJSON(text) {
  if (!text || typeof text !== "string") return {};
  try {
    const fenceMatch = text.match(/```(?:\w+)?([\s\S]*?)```/i);
    if (fenceMatch) return JSON.parse(fenceMatch[1].trim());
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return JSON.parse(text.trim());
  } catch (err) {
    console.error("❌ Failed to parse Claude JSON:", err.message);
    console.error("Raw text was:\n", text);
    return {};
  }
}


function validateDateFormat(dateString) {
  const regex = /^\d{2}\/\d{2}\/\d{2}$/;
  return regex.test(dateString);
}

function calculateDaysDifference(startDate, endDate) {
  const [startDay, startMonth, startYear] = startDate.split("/").map(n => parseInt(n));
  const [endDay, endMonth, endYear] = endDate.split("/").map(n => parseInt(n));
  const startFullYear = startYear < 50 ? 2000 + startYear : 1900 + startYear;
  const endFullYear = endYear < 50 ? 2000 + endYear : 1900 + endYear;
  const start = new Date(startFullYear, startMonth - 1, startDay);
  const end = new Date(endFullYear, endMonth - 1, endDay);
  const diffMs = end.getTime() - start.getTime();
  return Math.ceil(diffMs / (1000 * 3600 * 24)) + 1;
}


let lastRecommendations = [];
let tripDates = { start: "", end: "" };
let tripCity = "";



// /prompt
app.post("/prompt", async (req, res) => {
  const { city, start_date, end_date } = req.body;

  if (!city) return res.status(400).json({ error: "City is required" });
  if (!start_date || !end_date)
    return res.status(400).json({ error: "Start and end dates are required" });
  if (!validateDateFormat(start_date) || !validateDateFormat(end_date))
    return res.status(400).json({ error: "Dates must be in dd/mm/yy format" });

  tripDates.start = start_date;
  tripDates.end = end_date;
  tripCity = city;

  const totalDays = calculateDaysDifference(start_date, end_date);

  const prompt = `
Plan a trip for ${city} from ${start_date} to ${end_date}.
Distribute tourist places across ${totalDays} days.
Each day must include 3 to 4 famous tourist places.

Return strictly valid JSON in this format:
{
  "days": [
    { "day": 1, "date": "YYYY-MM-DD", "places": ["Place 1", "Place 2", "Place 3"] },
    { "day": 2, "date": "YYYY-MM-DD", "places": ["Place 4", "Place 5", "Place 6"] }
  ]
}
`;

  try {
    const raw = await callClaude(prompt);
    let recommendations = extractJSON(raw);

    lastRecommendations = recommendations.days?.flatMap(day => day.places) || [];

    res.json({
      city,
      recommendations,
      start_date,
      end_date,
      total_days: totalDays,
    });
  } catch (err) {
    res.status(500).json({ error: "Error fetching tourist places", details: err.message });
  }
});

// /temp
app.post("/temp", async (req, res) => {
  let { cities, city } = req.body;

  if (!cities || !Array.isArray(cities) || cities.length === 0) {
    if (lastRecommendations.length === 0) {
      if (!city) return res.status(400).json({ error: "No city info available" });
      return res.status(400).json({ error: "Call /prompt first to get tourist places" });
    }
    cities = lastRecommendations;
  }

  if (!Array.isArray(cities)) cities = [cities];

  const prompt = `Give the current temperature and weather condition (e.g. cloudy, sunny) for each of these places: ${cities.join(
    ", "
  )}.
Return strictly valid JSON:
[
  { "city": "Place 1", "temperature": "25°C", "Weather Condition": "Sunny" }
]`;

  try {
    const raw = await callClaude(prompt);
    const temperatureData = extractJSON(raw);
    res.json({ results: temperatureData });
  } catch (err) {
    res.status(500).json({ error: "Error fetching temperature", details: err.message });
  }
});

// /transport
app.post("/transport", async (req, res) => {
  const { places } = req.body;

  if (!places || !Array.isArray(places) || places.length === 0) {
    if (!lastRecommendations.length || !tripCity) {
      return res.status(400).json({ error: "No places info" });
    }
  }

  const targetPlaces =
    places && Array.isArray(places) && places.length > 0 ? places : lastRecommendations;

  const prompt = `Provide the best transportation method to reach each place in ${tripCity}.
For places: ${targetPlaces.join(", ")}, from Majestic and Kempegowda Airport.
Return strictly valid JSON array:
[
  { "place": "Place 1", "fromMajestic": "Bus/Metro", "fromAirport": "Taxi/Uber" }
]`;

  try {
    const raw = await callClaude(prompt);
    const transportInfo = extractJSON(raw);
    res.json({ transport: transportInfo });
  } catch (err) {
    res.status(500).json({ error: "Error fetching transport info", details: err.message });
  }
});

// /finalTrip
app.post("/finalTrip", async (req, res) => {
  const { transportData, temperatureData } = req.body;

  if (!tripDates.start || !tripDates.end || !tripCity) {
    return res.status(400).json({ error: "Trip info not initialized. Call /prompt first." });
  }

  const totalDays = calculateDaysDifference(tripDates.start, tripDates.end);

  const prompt = `Create a detailed day-wise trip plan for ${tripCity} from ${tripDates.start} to ${tripDates.end} (${totalDays} days).
Strictly only give Daywise plan (Day 1: ...).
Use transport info: ${JSON.stringify(transportData || [])}.
${temperatureData ? `Use weather info: ${JSON.stringify(temperatureData)}` : ""}
Each day must include:
- places
- transport
- weather
- activities
- costs
- tips

Return structured plan as plain text (not JSON).`;

  try {
    const raw = await callClaude(prompt);
    res.json({
      city: tripCity,
      start_date: tripDates.start,
      end_date: tripDates.end,
      total_days: totalDays,
      trip_plan: raw,
    });
  } catch (err) {
    res.status(500).json({ error: "Error generating trip plan", details: err.message });
  }
});

// /detailedTrip 
app.post("/detailedTrip", async (req, res) => {
  const { city, start_date, end_date } = req.body;

  if (!city) return res.status(400).json({ error: "City is required" });
  if (!start_date || !end_date)
    return res.status(400).json({ error: "Start and end dates are required" });
  if (!validateDateFormat(start_date) || !validateDateFormat(end_date))
    return res.status(400).json({ error: "Dates must be in dd/mm/yy format" });

  const totalDays = calculateDaysDifference(start_date, end_date);

  const prompt = `
Create a very detailed day-wise trip plan for ${city} from ${start_date} to ${end_date} (${totalDays} days).

Each day must include:
- tourist places to visit
- local transport options
- expected weather (use reasonable assumptions)
- suggested activities
- approximate costs (in local currency)
- travel tips

Format the response as structured plain text, not JSON.
`;

  try {
    const raw = await callClaude(prompt);
    res.json({
      city,
      start_date,
      end_date,
      total_days: totalDays,
      trip_plan: raw,
    });
  } catch (err) {
    res.status(500).json({ error: "Error generating detailed trip plan", details: err.message });
  }
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
