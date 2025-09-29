const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const EventEmitter = require("events");

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const REGION = process.env.AWS_REGION || "us-east-1";

// Bedrock Client
const bedrockClient = new BedrockRuntimeClient({ region: REGION });

// Event bus for optional agent-to-agent communication
const agentBus = new EventEmitter();

// ---------------- Utility Functions ----------------
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
    console.error("JSON Parse Error:", err.message);
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

//Agents 
async function TourAgent(city, totalDays, excludePlaces = []) {
  const exclusionText = excludePlaces.length ? `Exclude: ${excludePlaces.join(", ")}.` : "";
  const prompt = `
You are a TourAgent.
List tourist attractions in ${city} for ${totalDays} days.
${exclusionText}
Return JSON: { "days": [ { "day": 1, "places": ["Place A", "Place B"] } ] }
  `;
  const tourText = await callClaude(prompt);
  const tourData = extractJSON(tourText);

  agentBus.emit("tourReady", tourData); 
  return tourData;
}

async function WeatherAgent(city, places = []) {
  if (!places.length) return [];
  const prompt = `
You are a WeatherAgent.
Provide weather forecasts for ${city} covering: ${places.join(", ")}.
Return JSON array: [ { "place": "Place A", "date": "YYYY-MM-DD", "weather": "Rainy", "temperature": "20°C" } ]
  `;
  const weatherText = await callClaude(prompt);
  const weatherData = extractJSON(weatherText);

  agentBus.emit("weatherReady", weatherData); 
  return weatherData;
}

async function TransportAgent(city, places = [], weatherData = []) {
  if (!places.length) return [];
  const prompt = `
You are a TransportAgent.
Suggest local transport for these places in ${city}, considering weather conditions.
Return JSON array: [ { "place": "Place A", "fromMajestic": "Metro", "fromAirport": "Taxi" } ]
  `;
  const transportText = await callClaude(prompt);
  const transportData = extractJSON(transportText);

  agentBus.emit("transportReady", transportData); 
  return transportData;
}

async function PlannerAgent(city, tourData = [], weatherData = [], transportData = []) {
  const prompt = `
You are a PlannerAgent.
Create a day-wise detailed trip plan for ${city}.
Tourist places: ${JSON.stringify(tourData)}
Weather: ${JSON.stringify(weatherData)}
Transport: ${JSON.stringify(transportData)}
Include:
- Places
- Transport
- Weather
- Activities
- Costs
- Tips
Return as structured plain text.
  `;
  const tripPlan = await callClaude(prompt);

  agentBus.emit("planReady", tripPlan); 
  return tripPlan;
}

// ---------------- Feedback Loop ----------------
agentBus.on("replanTour", async (city, totalDays, badPlaces) => {
  console.log("Replanning tour due to bad weather for:", badPlaces);
  const tourData = await TourAgent(city, totalDays, badPlaces);
  const allPlaces = tourData.days.flatMap(d => d.places);
  const weatherData = await WeatherAgent(city, allPlaces);

  const badWeatherPlaces = weatherData
    .filter(w => w.weather.toLowerCase().includes("rain"))
    .map(w => w.place);

  if (badWeatherPlaces.length > 0) {
    agentBus.emit("replanTour", city, totalDays, badWeatherPlaces);
  } else {
    const transportData = await TransportAgent(city, allPlaces, weatherData);
    const tripPlan = await PlannerAgent(city, tourData, weatherData, transportData);
    console.log("Trip plan ready after replanning:\n", tripPlan);
  }
});

// ---------------- API ----------------
app.post("/agentTrip", async (req, res) => {
  const { city, start_date, end_date } = req.body;
  if (!city || !start_date || !end_date)
    return res.status(400).json({ error: "City, start_date, end_date required" });

  const totalDays = calculateDaysDifference(start_date, end_date);

  try {
    // Run independent agents in sequence
    const tourData = await TourAgent(city, totalDays);
    const allPlaces = tourData.days.flatMap(d => d.places);

    const weatherData = await WeatherAgent(city, allPlaces);

    // Detect bad weather
    const badWeatherPlaces = weatherData
      .filter(w => w.weather.toLowerCase().includes("rain"))
      .map(w => w.place);

    if (badWeatherPlaces.length > 0) {
      // Trigger feedback loop
      agentBus.emit("replanTour", city, totalDays, badWeatherPlaces);
    }

    const transportData = await TransportAgent(city, allPlaces, weatherData);
    const tripPlan = await PlannerAgent(city, tourData, weatherData, transportData);

    res.json({ city, start_date, end_date, tripPlan });
  } catch (err) {
    console.error("Error generating trip:", err);
    res.status(500).json({ error: "Failed to generate trip plan" });
  }
});

app.post("/tourOnly", async (req, res) => {
  const { city, start_date, end_date } = req.body;
  if (!city || !start_date || !end_date) {
    return res.status(400).json({ error: "City, start_date, end_date required" });
  }

  const totalDays = calculateDaysDifference(start_date, end_date);

  try {
    const tourData = await TourAgent(city, totalDays);
    res.json({ city, start_date, end_date, tourData });
  } catch (err) {
    console.error("Error fetching tour:", err);
    res.status(500).json({ error: "Failed to fetch tour places" });
  }
});


// ---------------- Weather Only API ----------------
app.post("/weatherOnly", async (req, res) => {
  const { city, start_date, end_date } = req.body;
  if (!city || !start_date || !end_date) {
    return res.status(400).json({ error: "City, start_date, end_date required" });
  }

  const totalDays = calculateDaysDifference(start_date, end_date);

  try {
    // First, get places so we know what to fetch weather for
    const tourData = await TourAgent(city, totalDays);
    const allPlaces = tourData.days.flatMap(d => d.places);

    const weatherData = await WeatherAgent(city, allPlaces);

    res.json({ city, start_date, end_date, weatherData });
  } catch (err) {
    console.error("Error fetching weather:", err);
    res.status(500).json({ error: "Failed to fetch weather data" });
  }
});


app.listen(PORT, () => {
  console.log(`Agentic AI server running on http://localhost:${PORT}`);
});
