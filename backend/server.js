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

// Claude call 
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
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    }),
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  return responseBody.content[0].text;
}

function extractJSON(text) {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error(" JSON Parse Error:", err.message);
  }
  return {};
}


function calculateDaysDifference(startDate, endDate) {
  const [sd, sm, sy] = startDate.split("/").map(Number);
  const [ed, em, ey] = endDate.split("/").map(Number);
  const sYear = sy < 50 ? 2000 + sy : 1900 + sy;
  const eYear = ey < 50 ? 2000 + ey : 1900 + ey;
  const s = new Date(sYear, sm - 1, sd);
  const e = new Date(eYear, em - 1, ed);
  return Math.ceil((e - s) / (1000 * 3600 * 24)) + 1;
}

// ---------------- Agents ----------------

// TourAgent
async function TourAgent(city, totalDays, excludePlaces = []) {
  const exclusionText = excludePlaces.length
    ? `Exclude these places: ${excludePlaces.join(", ")}.`
    : "";

  const prompt = `
You are a TourAgent.
List tourist attractions in ${city} for ${totalDays} days.
${exclusionText}
Return JSON: { "days": [ { "day": 1, "places": ["Place A", "Place B"] } ] }
  `;
  const tourText = await callClaude(prompt);
  return extractJSON(tourText);
}

// WeatherAgent
async function WeatherAgent(city, tourData) {
  const allPlaces = tourData.days?.flatMap(d => d.places) || [];
  const prompt = `
You are a WeatherAgent.
Provide weather forecasts for ${city} covering these places: ${allPlaces.join(", ")}.
Return JSON array: [ { "place": "Place A", "date": "YYYY-MM-DD", "weather": "Rainy", "temperature": "20°C" } ]
  `;
  const weatherText = await callClaude(prompt);
  const weatherData = extractJSON(weatherText);

  // Feedback: bad weather
  const badWeatherPlaces = weatherData
    .filter(w => w.weather.toLowerCase().includes("rain"))
    .map(w => w.place);

  if (badWeatherPlaces.length > 0) {
    console.log(" Bad weather detected, notifying TourAgent...");
    const newTourData = await TourAgent(city, tourData.days.length, badWeatherPlaces);
    return await WeatherAgent(city, newTourData);
  }

  return weatherData;
}

// TransportAgent
async function TransportAgent(city, weatherData) {
  const allPlaces = weatherData.map(w => w.place);
  const prompt = `
You are a TransportAgent.
Suggest local transport for these places in ${city}, considering weather conditions.
Return JSON array: [ { "place": "Place A", "fromMajestic": "Metro", "fromAirport": "Taxi" } ]
  `;
  const transportText = await callClaude(prompt);
  return extractJSON(transportText);
}

// PlannerAgent (Final)
async function PlannerAgent(city, tourData, weatherData, transportData) {
  const finalPrompt = `
You are a PlannerAgent.
Create a day-wise detailed trip plan for ${city} (${tourData.days.length} days).
Use this info:
- Tourist places: ${JSON.stringify(tourData)}
- Weather: ${JSON.stringify(weatherData)}
- Transport: ${JSON.stringify(transportData)}
Include:
- Places
- Transport
- Weather
- Activities
- Costs
- Tips
Return as structured plain text.
  `;
  return await callClaude(finalPrompt);
}

// ---------------- Orchestrator for agent-to-agent flow ----------------
async function AgentOrchestrator(city, start_date, end_date) {
  const totalDays = calculateDaysDifference(start_date, end_date);

  // TourAgent → WeatherAgent (feedback built-in) → TransportAgent
  const tourData = await TourAgent(city, totalDays);
  const weatherData = await WeatherAgent(city, tourData);
  const transportData = await TransportAgent(city, weatherData);

  // PlannerAgent final synthesis
  return await PlannerAgent(city, tourData, weatherData, transportData);
}

// ---------------- API ----------------
app.post("/agentTrip", async (req, res) => {
  const { city, start_date, end_date } = req.body;
  if (!city || !start_date || !end_date)
    return res.status(400).json({ error: "City, start_date, end_date required" });

  try {
    const tripPlan = await AgentOrchestrator(city, start_date, end_date);
    res.json({ city, start_date, end_date, tripPlan });
  } catch (err) {
    res.status(500).json({ error: "Agentic planning failed", details: err.message });
  }
});


app.listen(PORT, () => {
  console.log(` Agentic AI server running on http://localhost:${PORT}`);
});
