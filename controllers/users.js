const User = require("../models/user.js")
const Booking = require("../models/booking.js")
const Listing = require("../models/listing.js")
const Wishlist = require("../models/wishlist.js")

module.exports.signupForm = (req,res) => {
    res.render("./users/signup.ejs");
}

module.exports.signupUser = async (req, res, next) => {
    try {
        let { email, username, password } = req.body;

        // Check if user already exists by username or email
        const existingUser = await User.findOne({
            $or: [{ username: username }, { email: email }]
        });

        if (existingUser) {
            // Determine the exact cause
            let message = "User already registered with ";
            if (existingUser.username === username && existingUser.email === email) {
                message += "this username and email.";
            } else if (existingUser.username === username) {
                message += "this username.";
            } else if (existingUser.email === email) {
                message += "this email.";
            }

            req.flash("error", message);
            return res.redirect("/signup");
        }

        // If no existing user, proceed with registration
        let newUser = new User({ email, username });
        const regUser = await User.register(newUser, password);

        req.login(regUser, (err) => {
            if (err) {
                return next(err);
            }
            req.flash("success", "Welcome to Rentify");
            res.redirect("/listings");
        });

    } catch (error) {
        req.flash("error", "Something went wrong. Please try again.");
        res.redirect("/signup");
    }
}


module.exports.loginForm = (req, res) =>{
    res.render("./users/login.ejs")
}

module.exports.loginUser = async(req, res) => {
        req.flash("success", "Welcome Back to Rentify!")
        let redirectUrl = res.locals.redirectUrl || "/listings";
        res.redirect(redirectUrl);
}

module.exports.logoutUser = async (req, res, next) => {
    req.logout((err) => {
        if(err){
            return next(err);
        }
        req.flash("success", "Logged Out Successfully.")
        res.redirect("/listings");
    });
}

module.exports.profile = async (req,res) => {
    let { id } = req.params;
    const user = await User.findById(id);
    const [bookingsCount, listingsCount, wishlistCount] = await Promise.all([
        Booking.countDocuments({ user: id }),
        Listing.countDocuments({ owner: id }),
        Wishlist.countDocuments({ user: id })
    ]);
    res.render("users/profile", { user, bookingsCount, listingsCount, wishlistCount });
}

module.exports.uploadProfilePic = async (req, res) => {
    try {
        const userId = req.body.userId;
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        if (!req.file || !req.file.path) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        // Save the Cloudinary image URL to the user's profile
        user.profileImage = req.file.path;
        await user.save();
        res.redirect(`/profile/${userId}`);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};