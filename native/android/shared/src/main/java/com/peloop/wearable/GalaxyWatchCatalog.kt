package com.peloop.wearable

data class GalaxyWatchProfile(val modelCode: String, val productName: String, val releaseDate: String, val minWatchApi: Int, val minPhoneApi: Int)

/** Date/OS candidates only; entries do not certify device compatibility. */
object GalaxyWatchCatalog {
    private val profiles = buildMap {
        fun add(name: String, date: String, watch: Int, phone: Int, vararg ids: String) {
            ids.forEach { put(it, GalaxyWatchProfile(it, name, date, watch, phone)) }
        }
        add("Galaxy Watch6", "2023-08-11", 33, 29, "SM-R930", "SM-R935", "SM-R935F", "SM-R935U", "SM-R935N", "SM-R940", "SM-R945", "SM-R945F", "SM-R945U", "SM-R945N")
        add("Galaxy Watch6 Classic", "2023-08-11", 33, 29, "SM-R950", "SM-R950N", "SM-R955", "SM-R955F", "SM-R955U", "SM-R955N", "SM-R960", "SM-R960N", "SM-R965", "SM-R965F", "SM-R965U", "SM-R965N")
        add("Galaxy Watch FE", "2024-06-24", 30, 29, "SM-R861", "SM-R861N")
        add("Galaxy Watch7", "2024-07-24", 34, 30, "SM-L300", "SM-L300N", "SM-L305", "SM-L305F", "SM-L305U", "SM-L310", "SM-L310N", "SM-L315", "SM-L315F", "SM-L315U", "SM-L315N")
        add("Galaxy Watch Ultra", "2024-07-24", 34, 30, "SM-L705", "SM-L705F", "SM-L705U", "SM-L705N")
        add("Galaxy Watch8", "2025-07-25", 36, 31, "SM-L320", "SM-L320N", "SM-L325", "SM-L325F", "SM-L325U", "SM-L330", "SM-L330N", "SM-L335", "SM-L335F", "SM-L335U")
        add("Galaxy Watch8 Classic", "2025-07-25", 36, 31, "SM-L500", "SM-L500N", "SM-L505", "SM-L505F", "SM-L505U")
        add("Galaxy Watch9", "2026-08-07", 37, 33, "SM-L340", "SM-L345", "SM-L345F", "SM-L345U", "SM-L350", "SM-L355", "SM-L355F", "SM-L355U")
        add("Galaxy Watch Ultra2", "2026-08-07", 37, 33, "SM-L715F", "SM-L715N", "SM-L715U")
    }
    fun lookup(rawModel: String): GalaxyWatchProfile? = profiles[rawModel.trim().uppercase()]
    fun watchAllowed(profile: GalaxyWatchProfile, api: Int): Boolean = api >= profile.minWatchApi
    fun phoneAllowed(profile: GalaxyWatchProfile, api: Int): Boolean = api >= profile.minPhoneApi
}
