if(process.env.NODE_ENV != "production"){
  require('dotenv').config()
}

const express = require("express");
const app = express();
const mongoose = require("mongoose");
const path = require("path");
const methodOverride = require("method-override");
const ejsMate = require("ejs-mate");
const ExpressError = require("./utils/ExpressError.js");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const MongoStore = require('connect-mongo');
const flash = require("connect-flash");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const User = require("./models/user.js")

const listingRoute = require("./routes/listings.js");
const reviewRoute = require("./routes/review.js");
const userRoute = require("./routes/user.js");
const profileRoute = require("./routes/profile.js");
const bookingRoute = require("./routes/bookings.js");
const wishlistRoute = require('./routes/wishlist.js');
const chatRoute = require('./routes/chat.js');

const dbUrl = process.env.ATLASDB_URl;

// MongoDB connection
mongoose.connect(dbUrl)
  .then(() => console.log("Connected to DB"))
  .catch(err => console.error("DB connection error:", err));

// App Configurations
app.set("view engine", "ejs");
app.engine("ejs", ejsMate);
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, "public"))); // if you have static files
app.use(cookieParser("secretecode"));

// Serve receipts folder as static
app.use("/receipts", express.static(path.join(__dirname, "receipts")));

const store = MongoStore.create({
  mongoUrl: dbUrl,
  crypto:{
    secret: process.env.SECRET
  },
  touchAfter: 24 * 3600,
});

store.on("error", (error) => {
  console.log("error in mongo Session Store", error)
});

const sessionOptions = {
  store: store, 
  secret: process.env.SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: {
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
  }
}

app.use(session(sessionOptions));
app.use(flash());

// Authenticate user
app.use(passport.initialize());
app.use(passport.session());

// static authenticate method of model in LocalStrategy
passport.use(new LocalStrategy(User.authenticate()));

// static serialize and deserialize of model for passport session support
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use((req, res, next) => {
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.currUser = req.user;
  next();
});

// listings routes
app.use("/listings", listingRoute);

// review routes
app.use("/listings/:id/review", reviewRoute);

// user routes
app.use("/", userRoute);

// profile route
app.use("/", profileRoute);

// wishlist route
app.use('/', wishlistRoute);

// booking router
app.use("/api/bookings", bookingRoute);

// chat router
app.use("/chat", chatRoute);

// 404 Not Found
app.use((req, res, next) => {
  next(new ExpressError(404, "Page Not Found!"));
});

app.use((err, req, res, next) => {
  // console.log(err);
  let { statusCode = 500, message = "Something went wrong" } = err;
  res.status(statusCode).render("./listings/error.ejs" , {message});
  // res.status(statusCode).send(message);
});

// Start Server
app.listen(8080, () => {
  console.log("App is listening on port 8080...");
});

