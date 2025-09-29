import React, { useState } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import axios from "axios";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import "./App.css";

export default function App() {
  const [city, setCity] = useState("");
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [tripData, setTripData] = useState(null);
  const [tourData, setTourData] = useState(null);
  const [weatherData, setWeatherData] = useState(null);

  const [tripLoading, setTripLoading] = useState(false);
  const [tourLoading, setTourLoading] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(false);

  const formatDate = (date) => {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = String(date.getFullYear()).slice(-2);
    return `${day}/${month}/${year}`;
  };

  const fetchTripPlan = async () => {
    if (!startDate || !endDate) return alert("Please select both start and end dates");
    setTripData(null); setTourData(null); setWeatherData(null); setTripLoading(true);
    try {
      const payload = { city, start_date: formatDate(startDate), end_date: formatDate(endDate) };
      const response = await axios.post("http://localhost:5000/agentTrip", payload);
      setTripData({ city, start_date: response.data.start_date, end_date: response.data.end_date, tripPlan: response.data.tripPlan });
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || "Failed to fetch trip plan"}`);
    } finally { setTripLoading(false); }
  };

  const fetchTourOnly = async () => {
    if (!startDate || !endDate) return alert("Please select both start and end dates");
    setTripData(null); setTourData(null); setWeatherData(null); setTourLoading(true);
    try {
      const payload = { city, start_date: formatDate(startDate), end_date: formatDate(endDate) };
      const response = await axios.post("http://localhost:5000/tourOnly", payload);
      setTourData(response.data.tourData);
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || "Failed to fetch places"}`);
    } finally { setTourLoading(false); }
  };

  const fetchWeatherOnly = async () => {
    if (!startDate || !endDate) return alert("Please select both start and end dates");
    setTripData(null); setTourData(null); setWeatherData(null); setWeatherLoading(true);
    try {
      const payload = { city, start_date: formatDate(startDate), end_date: formatDate(endDate) };
      const response = await axios.post("http://localhost:5000/weatherOnly", payload);
      setWeatherData(response.data.weatherData);
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || "Failed to fetch weather data"}`);
    } finally { setWeatherLoading(false); }
  };

  const downloadPDF = () => {
    const input = document.querySelector(".trip-output");
    if (!input) return;
    html2canvas(input, { scale: 2 }).then((canvas) => {
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const imgHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, imgHeight);
      pdf.save(`TripPlan_${city}.pdf`);
    });
  };

  return (
    <div className="app-container">
      <h1>Trip Planner</h1>

      <div className="form-group">
        <label>City:</label>
        <select value={city} onChange={(e) => setCity(e.target.value)}>
          <option value="">Select a City</option>
          <option value="Bangalore">Bangalore</option>
          <option value="Hyderabad">Hyderabad</option>
        </select>
      </div>

      <div className="form-group">
        <label>Start Date:</label>
        <DatePicker selected={startDate} onChange={setStartDate} dateFormat="dd/MM/yyyy" placeholderText="Select start date" />
      </div>

      <div className="form-group">
        <label>End Date:</label>
        <DatePicker selected={endDate} onChange={setEndDate} dateFormat="dd/MM/yyyy" placeholderText="Select end date" />
      </div>

      <div className="get-trip-btn-container">
        <button className="btn" onClick={fetchTripPlan} disabled={tripLoading}>{tripLoading ? "Loading..." : "Get Trip Plan"}</button>
        <button className="btn" onClick={fetchTourOnly} disabled={tourLoading} style={{ marginLeft: "10px" }}>{tourLoading ? "Loading..." : "Get Places Only"}</button>
        <button className="btn" onClick={fetchWeatherOnly} disabled={weatherLoading} style={{ marginLeft: "10px" }}>{weatherLoading ? "Loading..." : "Get Weather Only"}</button>
      </div>

      {/* Full Trip Plan */}
      {tripData && (
        <div className="trip-output">
          <h2>Trip Plan for {tripData.city} ({tripData.start_date} → {tripData.end_date})</h2>
          <div className="trip-plan-box">
            {tripData.tripPlan.split("\n").map((line, idx) => {
              const headingMatch = line.match(/^(Day\s*\d+|Places|Transport|Weather|Activities|Costs|Tips)\s*[:\-]?/i);
              if (headingMatch) {
                const heading = headingMatch[1];
                const rest = line.slice(headingMatch[0].length).trim();
                return <p key={idx}><strong className="trip-heading">{heading}:</strong> {rest}</p>;
              }
              return <p key={idx}>{line}</p>;
            })}
          </div>
          <div className="download-btn-container">
            <button className="btn" onClick={downloadPDF}>Download as PDF</button>
          </div>
        </div>
      )}

      {/* Places Only */}
      {tourData && (
        <div className="tour-output">
          <h2>Places for {city}</h2>
          {tourData.days.map((day, idx) => (
            <div key={idx}><strong>Day {day.day}:</strong> {day.places.join(", ")}</div>
          ))}
        </div>
      )}

      {/* Weather Only */}
      {weatherData && (
        <div className="weather-output">
          <h2>Weather Forecast for {city}</h2>
          {weatherData.map((w, idx) => (
            <div key={idx}><strong>{w.place}:</strong> {w.weather}, {w.temperature}</div>
          ))}
        </div>
      )}
    </div>
  );
}
